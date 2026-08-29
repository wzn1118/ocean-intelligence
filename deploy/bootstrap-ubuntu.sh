#!/usr/bin/env sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root." >&2
  exit 1
fi

. /etc/os-release
if [ "${ID:-}" != "ubuntu" ]; then
  echo "This bootstrap script supports Ubuntu only." >&2
  exit 1
fi

ubuntu_apt_mirror="${UBUNTU_APT_MIRROR:-}"
if [ -n "$ubuntu_apt_mirror" ]; then
  if [ ! -f /etc/apt/sources.list.pre-ocean-deploy ]; then
    cp /etc/apt/sources.list /etc/apt/sources.list.pre-ocean-deploy
  fi
  sed -i \
    -e "s|http://archive.ubuntu.com/ubuntu|$ubuntu_apt_mirror|g" \
    -e "s|http://security.ubuntu.com/ubuntu|$ubuntu_apt_mirror|g" \
    /etc/apt/sources.list
fi

apt-get update
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
docker_apt_mirror="${DOCKER_APT_MIRROR:-https://download.docker.com/linux/ubuntu}"
curl -fsSL "$docker_apt_mirror/gpg" -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

architecture="$(dpkg --print-architecture)"
printf '%s\n' \
  "deb [arch=${architecture} signed-by=/etc/apt/keyrings/docker.asc] ${docker_apt_mirror} ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

docker_registry_mirror="${DOCKER_REGISTRY_MIRROR:-}"
if [ -n "$docker_registry_mirror" ]; then
  install -m 0755 -d /etc/docker
  if [ -e /etc/docker/daemon.json ]; then
    echo "Existing /etc/docker/daemon.json was not overwritten; configure the registry mirror manually." >&2
  else
    printf '{\n  "registry-mirrors": ["%s"]\n}\n' "$docker_registry_mirror" > /etc/docker/daemon.json
  fi
fi

systemctl enable --now docker
systemctl restart docker

docker --version
docker compose version
