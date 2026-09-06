import hashlib
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import shutil
import stat
import sys
import zipfile


MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_ENTRIES = 256


class ArtifactError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ArtifactError(message)


def checked_path(name):
    require(isinstance(name, str) and name and len(name.encode('utf-8')) <= 2048, 'invalid member name')
    require(not any(ord(character) < 32 or ord(character) == 127 for character in name), 'control character in path')
    require('\\' not in name and ':' not in name and not PureWindowsPath(name).drive, 'non-portable member path')
    cleaned = name[:-1] if name.endswith('/') else name
    require(not cleaned.startswith('/') and all(part not in ('', '.', '..') for part in cleaned.split('/')), 'unsafe member path')
    parts = PurePosixPath(cleaned).parts
    require(len(parts) <= 16 and all(len(part.encode('utf-8')) <= 255 for part in parts), 'member path exceeds limits')
    return '/'.join(parts)


def inspect_entries(archive):
    entries = archive.infolist()
    require(0 < len(entries) <= MAX_ENTRIES, 'archive entry count exceeds limits')
    names = {}
    total = 0
    for entry in entries:
        require(entry.orig_filename == entry.filename, 'truncated member name')
        name = checked_path(entry.filename)
        require(name not in names, 'duplicate member path')
        require(not entry.flag_bits & 1, 'encrypted archives are not supported')
        require(entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), 'unsupported compression method')
        kind = stat.S_IFMT(entry.external_attr >> 16)
        require(kind in (0, stat.S_IFREG, stat.S_IFDIR), 'links and special files are forbidden')
        require(kind != stat.S_IFDIR or entry.is_dir(), 'inconsistent directory metadata')
        require(not entry.is_dir() or kind in (0, stat.S_IFDIR), 'inconsistent file metadata')
        require(0 <= entry.file_size <= MAX_FILE_BYTES, 'member size exceeds limits')
        require(not entry.is_dir() or entry.file_size == 0, 'nonempty directory member')
        total += entry.file_size
        require(total <= MAX_TOTAL_BYTES, 'total extracted size exceeds limits')
        names[name] = entry
    for name in names:
        parts = name.split('/')
        for length in range(1, len(parts)):
            parent = names.get('/'.join(parts[:length]))
            require(parent is None or parent.is_dir(), 'file and directory paths conflict')
    return names


def reject_symlink_parents(directory):
    current = Path(directory.anchor)
    for part in directory.parts[1:]:
        current /= part
        info = current.lstat()
        require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode), 'unsafe destination parent')


def extract_artifact(archive_path, destination):
    archive_path = Path(archive_path)
    destination = Path(destination)
    require(destination.is_absolute() and '..' not in destination.parts, 'destination must be an absolute new directory')
    reject_symlink_parents(destination.parent)
    info = archive_path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'archive must be an unlinked regular file')
    require(info.st_size <= MAX_ARCHIVE_BYTES, 'archive size exceeds limits')
    created = False
    try:
        descriptor = os.open(archive_path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, 'rb') as source_archive, zipfile.ZipFile(source_archive) as archive:
            opened = os.fstat(source_archive.fileno())
            require((opened.st_dev, opened.st_ino, opened.st_size) == (info.st_dev, info.st_ino, info.st_size),
                    'archive changed while opening')
            entries = inspect_entries(archive)
            destination.mkdir(mode=0o700, exist_ok=False)
            created = True
            files = []
            total = 0
            for name, entry in entries.items():
                target = destination.joinpath(*name.split('/'))
                if entry.is_dir():
                    target.mkdir(mode=0o700, parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                digest = hashlib.sha256()
                size = 0
                with os.fdopen(descriptor, 'wb') as output, archive.open(entry) as source:
                    while True:
                        chunk = source.read(64 * 1024)
                        if not chunk:
                            break
                        size += len(chunk)
                        total += len(chunk)
                        require(size <= MAX_FILE_BYTES and total <= MAX_TOTAL_BYTES and size <= entry.file_size,
                                'streamed size exceeds limits')
                        output.write(chunk)
                        digest.update(chunk)
                require(size == entry.file_size, 'member size mismatch')
                files.append({'file': name, 'bytes': size, 'sha256': digest.hexdigest()})
            after = os.fstat(source_archive.fileno())
            require((after.st_size, after.st_mtime_ns, after.st_ctime_ns) ==
                    (info.st_size, info.st_mtime_ns, info.st_ctime_ns), 'archive changed while reading')
            return {'files': files, 'bytes': total}
    except BaseException:
        if created:
            shutil.rmtree(destination)
        raise


def main():
    if len(sys.argv) != 3:
        raise ArtifactError('expected archive path and destination')
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
    except ImportError:
        raise ArtifactError('POSIX resource limits are required')
    result = extract_artifact(sys.argv[1], sys.argv[2])
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except (ArtifactError, OSError, zipfile.BadZipFile, RuntimeError, MemoryError):
        print('Artifact extraction failed safety or integrity checks.', file=sys.stderr)
        sys.exit(1)
