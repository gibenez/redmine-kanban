#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
name="sprint-board-test-$$"
network="$name-net"
tmp="$(mktemp -d)"
cleanup() {
  docker rm -f "$name" "$name-upstream" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
command -v jq >/dev/null
# Deployment needs only a URL; no pre-existing external Docker network.
REDMINE_URL=https://redmine.example.test BACKLOG_STATUS_ID=1 COLUMN_STATUS_IDS=1,2,3,5 \
  docker compose config --format json | jq -e '.services["sprint-board"].environment.REDMINE_URL == "https://redmine.example.test" and ([.networks[] | .external // false] | all(. == false))' >/dev/null
docker build -t redmine-sprint-board:test .
# Build-mode runtime configuration is generated without rebuilding the image.
docker run --rm --entrypoint /bin/sh -e REDMINE_URL=https://redmine.example.test \
  -e BACKLOG_STATUS_ID=1 -e COLUMN_STATUS_IDS=1,2,3,5 \
  -e SPRINT_SOURCE=build -e BUILD_TRACKER_ID=9 redmine-sprint-board:test \
  -c '/docker-entrypoint.d/40-board-config.sh && jq -e '\''.sprintSource == "build" and .buildTrackerId == 9'\'' /usr/share/nginx/html/config.json' >/dev/null
docker network create "$network" >/dev/null
docker run -d --name "$name-upstream" --network "$network" --network-alias mock \
  -v "$PWD/tests/fixtures/mock-redmine.mjs:/mock.mjs:ro" node:24-alpine node /mock.mjs >/dev/null
docker run -d --name "$name" --network "$network" -p 127.0.0.1::8080 \
  -e REDMINE_URL=http://mock:3000/redmine \
  -e BACKLOG_STATUS_ID=1 -e COLUMN_STATUS_IDS=1,2,3,5 redmine-sprint-board:test >/dev/null
port="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "8080/tcp") 0).HostPort}}' "$name")"
base="http://127.0.0.1:$port"
for attempt in $(seq 1 30); do
  if curl -fsS "$base/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS -D "$tmp/headers" "$base/config.json" | jq -e '.backlogStatusId == 1 and .columnStatusIds == [1,2,3,5] and .redminePublicUrl == "http://mock:3000/redmine"' >/dev/null
grep -qi 'Content-Security-Policy:.*script-src' "$tmp/headers"
grep -qi 'Cache-Control: no-store' "$tmp/headers"
curl -fsS -D "$tmp/proxy-headers" -H 'X-Redmine-API-Key: smoke-key' -H 'Cookie: session=bad' -H 'Authorization: Basic bad' -H 'X-Redmine-Switch-User: admin' "$base/redmine/issues.json?status_id=*" | jq -e '.keyForwarded and (.cookieForwarded|not) and (.authForwarded|not) and (.switchUserForwarded|not) and .path == "/redmine/issues.json?status_id=*"' >/dev/null
! grep -qi 'Set-Cookie:' "$tmp/proxy-headers"
grep -qi 'Content-Security-Policy: sandbox' "$tmp/proxy-headers"
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/redmine/users.json")" == 404 ]]
curl -fsS -X POST -H 'Content-Type: application/json' -d '{"issue":{"project_id":1,"tracker_id":9,"subject":"Sprint"}}' "$base/redmine/issues.json" | jq -e '.method == "POST" and .path == "/redmine/issues.json"' >/dev/null
curl -fsS -X PUT -H 'Content-Type: application/json' -d '{"issue":{"estimated_hours":1}}' "$base/redmine/issues/1.json" | jq -e '.method == "PUT"' >/dev/null
curl -fsS "$base/redmine/projects/1.json?include=issue_categories" | jq -e '.method == "GET" and .path == "/redmine/projects/1.json?include=issue_categories"' >/dev/null
curl -fsS "$base/redmine/issues/1/relations.json" | jq -e '.method == "GET"' >/dev/null
curl -fsS -X POST -H 'Content-Type: application/json' -d '{"relation":{"issue_to_id":2,"relation_type":"relates"}}' "$base/redmine/issues/1/relations.json" | jq -e '.method == "POST"' >/dev/null
curl -fsS -X DELETE "$base/redmine/relations/1.json" | jq -e '.method == "DELETE"' >/dev/null
[[ "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$base/redmine/issues/1.json")" == 404 ]]
[[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/redmine/projects/1.json")" == 404 ]]
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/redmine/projects/1/issue_categories.json")" == 404 ]]
# Run browser tests against production nginx, including its real CSP.
BOARD_TEST_URL="$base" npm run test:e2e
printf '\nDocker proxy, security headers, runtime config and browser tests passed.\n'
