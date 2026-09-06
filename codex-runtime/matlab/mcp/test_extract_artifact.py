import hashlib
import json
from pathlib import Path
import stat
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

from extract_artifact import ArtifactError, extract_artifact


class ExtractArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='matlab-artifact-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.archive = self.root / 'artifact.zip'
        self.destination = self.root / 'files'

    def write_zip(self, entries, compression=zipfile.ZIP_STORED):
        with warnings.catch_warnings(), zipfile.ZipFile(self.archive, 'w', compression=compression) as archive:
            warnings.simplefilter('ignore', UserWarning)
            for name, contents in entries:
                archive.writestr(name, contents)

    def test_valid_archive_regular_private_files_and_hashes(self):
        entries = [('execution.json', b'{}'), ('diary.log', b'MATLAB output'), ('outputs/result.json', b'{"value":2}')]
        self.write_zip(entries, zipfile.ZIP_DEFLATED)
        result = extract_artifact(self.archive, self.destination)
        for evidence, (name, contents) in zip(result['files'], entries):
            self.assertEqual(evidence, {'file': name, 'bytes': len(contents), 'sha256': hashlib.sha256(contents).hexdigest()})
            target = self.destination / name
            self.assertEqual(target.read_bytes(), contents)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        self.assertEqual(result['bytes'], sum(len(contents) for _, contents in entries))
        self.assertEqual(stat.S_IMODE(self.destination.stat().st_mode), 0o700)

    def test_unsafe_names_are_rejected_before_any_output(self):
        for name in ['../escape', '/tmp/escape', 'outputs/../../escape', 'C:/escape', 'outputs\\escape',
                     'outputs//escape', './escape', 'outputs/./escape', 'outputs/a:b', 'outputs/bad\nname']:
            with self.subTest(name=name):
                self.write_zip([('diary.log', b'first'), (name, b'bad')])
                with self.assertRaises(ArtifactError):
                    extract_artifact(self.archive, self.destination)
                self.assertFalse(self.destination.exists())
                self.assertFalse((self.root / 'escape').exists())

    def test_links_special_files_and_conflicting_members_are_rejected(self):
        for mode in [stat.S_IFLNK, stat.S_IFIFO, stat.S_IFSOCK, stat.S_IFCHR, stat.S_IFBLK]:
            entry = zipfile.ZipInfo('outputs/link')
            entry.create_system = 3
            entry.external_attr = (mode | 0o777) << 16
            self.write_zip([(entry, b'../../outside')])
            with self.assertRaises(ArtifactError):
                extract_artifact(self.archive, self.destination)
            self.assertFalse(self.destination.exists())
        for entries in [[('same', b'1'), ('same', b'2')], [('outputs', b'file'), ('outputs/result', b'2')],
                        [('outputs/result', b'2'), ('outputs', b'file')]]:
            self.write_zip(entries)
            with self.assertRaises(ArtifactError):
                extract_artifact(self.archive, self.destination)
            self.assertFalse(self.destination.exists())

    def test_bomb_and_count_limits_reject_before_extraction(self):
        self.write_zip([('outputs/zeros', b'0' * 100000)], zipfile.ZIP_DEFLATED)
        with patch('extract_artifact.MAX_FILE_BYTES', 99999), self.assertRaisesRegex(ArtifactError, 'size'):
            extract_artifact(self.archive, self.destination)
        cases = [('MAX_ENTRIES', 1, [('one', b'a'), ('two', b'b')]),
                 ('MAX_FILE_BYTES', 1, [('one', b'ab')]),
                 ('MAX_TOTAL_BYTES', 2, [('one', b'ab'), ('two', b'cd')]),
                 ('MAX_ARCHIVE_BYTES', 1, [('one', b'a')])]
        for name, limit, entries in cases:
            self.write_zip(entries)
            with patch('extract_artifact.' + name, limit), self.assertRaises(ArtifactError):
                extract_artifact(self.archive, self.destination)
            self.assertFalse(self.destination.exists())

    def test_high_compression_within_absolute_limits_is_valid(self):
        content = b'0' * 100000
        self.write_zip([('outputs/zeros', content)], zipfile.ZIP_DEFLATED)
        self.assertLess(self.archive.stat().st_size * 200, len(content))
        extract_artifact(self.archive, self.destination)
        self.assertEqual((self.destination / 'outputs/zeros').read_bytes(), content)

    def test_corrupt_crc_cleans_its_own_partial_output(self):
        self.write_zip([('diary.log', b'first'), ('outputs/data', b'UNIQUE_PAYLOAD')])
        contents = self.archive.read_bytes().replace(b'UNIQUE_PAYLOAD', b'BROKEN_PAYLOAD')
        self.archive.write_bytes(contents)
        with self.assertRaises(zipfile.BadZipFile):
            extract_artifact(self.archive, self.destination)
        self.assertFalse(self.destination.exists())

    def test_encryption_and_unsupported_compression_are_rejected(self):
        self.write_zip([('diary.log', b'text')])
        contents = bytearray(self.archive.read_bytes())
        central = contents.index(b'PK\x01\x02')
        struct.pack_into('<H', contents, central + 8, 1)
        self.archive.write_bytes(contents)
        with self.assertRaisesRegex(ArtifactError, 'encrypted'):
            extract_artifact(self.archive, self.destination)
        self.write_zip([('diary.log', b'text')], zipfile.ZIP_BZIP2)
        with self.assertRaisesRegex(ArtifactError, 'compression'):
            extract_artifact(self.archive, self.destination)
        self.assertFalse(self.destination.exists())

    def test_existing_destination_and_symlink_parents_are_never_overwritten(self):
        self.write_zip([('diary.log', b'new')])
        self.destination.mkdir()
        sentinel = self.destination / 'diary.log'
        sentinel.write_bytes(b'original')
        with self.assertRaises(FileExistsError):
            extract_artifact(self.archive, self.destination)
        self.assertEqual(sentinel.read_bytes(), b'original')
        link = self.root / 'link'
        link.symlink_to(self.destination, target_is_directory=True)
        with self.assertRaises(ArtifactError):
            extract_artifact(self.archive, link / 'nested')
        self.assertFalse((self.destination / 'nested').exists())

    def test_fixed_cli_returns_json_without_network_or_shell(self):
        self.write_zip([('execution.json', b'{}'), ('diary.log', b'ok')])
        process = subprocess.run([sys.executable, '-B', str(Path(__file__).with_name('extract_artifact.py')),
                                  str(self.archive), str(self.destination)], capture_output=True, text=True, timeout=20)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(len(json.loads(process.stdout)['files']), 2)


if __name__ == '__main__':
    unittest.main()
