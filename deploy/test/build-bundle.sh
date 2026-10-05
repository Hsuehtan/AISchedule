#!/usr/bin/env bash
set -euo pipefail

release_tag="${1:?usage: build-bundle.sh RELEASE_TAG OUTPUT_DIR}"
output_dir="${2:?usage: build-bundle.sh RELEASE_TAG OUTPUT_DIR}"

mkdir -p "${output_dir}"

docker buildx build --platform linux/amd64 --provenance=false --load \
  --file deploy/test/Dockerfile.server \
  --tag "ai-schedule-test-server:${release_tag}" .
docker buildx build --platform linux/amd64 --provenance=false --load \
  --file deploy/test/Dockerfile.web \
  --tag "ai-schedule-test-web:${release_tag}" .
docker buildx build --platform linux/amd64 --provenance=false --load \
  --file apps/agent-service/Dockerfile \
  --tag "ai-schedule-test-agent:${release_tag}" .
docker buildx build --platform linux/amd64 --provenance=false --load \
  --file deploy/test/Dockerfile.postgres \
  --tag ai-schedule-test-postgres:16-alpine .

docker image inspect \
  "ai-schedule-test-server:${release_tag}" \
  "ai-schedule-test-web:${release_tag}" \
  "ai-schedule-test-agent:${release_tag}" \
  ai-schedule-test-postgres:16-alpine \
  --format '{{.RepoTags}} {{.Architecture}}/{{.Os}}'

docker save \
  "ai-schedule-test-server:${release_tag}" \
  "ai-schedule-test-web:${release_tag}" \
  "ai-schedule-test-agent:${release_tag}" \
  ai-schedule-test-postgres:16-alpine \
  | gzip -1 > "${output_dir}/images-${release_tag}.tar.gz"

(
  cd "${output_dir}"
  shasum -a 256 "images-${release_tag}.tar.gz" \
    > "images-${release_tag}.tar.gz.sha256"
)
