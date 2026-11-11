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
REDMINE_URL=https://redmine.example.test SPRINT_FIELD_ID=7 BACKLOG_STATUS_ID=1 COLUMN_STATUS_IDS=1,2,3,5 \
  docker compose config --format json | jq -e '.services["sprint-board"].environment.REDMINE_URL == "https://redmine.example.test" and ([.networks[] | .external // false] | all(. == false))' >/dev/null
docker build -t redmine-sprint-board:test .
# Legacy Build deployments must stop before planning semantics change.
if docker run --rm --entrypoint /bin/sh -e SPRINT_SOURCE=build redmine-sprint-board:test \
  -c '/docker-entrypoint.d/40-board-config.sh' >"$tmp/legacy-error" 2>&1; then
  echo 'Legacy Build configuration was unexpectedly accepted' >&2; exit 1
fi
grep -q 'Build-based Sprints are no longer supported' "$tmp/legacy-error"
# Runtime configuration retains independent Swimlane settings, not removed source settings.
docker run --rm --entrypoint /bin/sh -e REDMINE_URL=https://redmine.example.test \
  -e SPRINT_FIELD_ID=7 -e BACKLOG_STATUS_ID=1 -e COLUMN_STATUS_IDS=1,2,3,5 \
  -e 'SWIMLANE_TRACKERS= Story , Bug ' redmine-sprint-board:test \
  -c '/docker-entrypoint.d/40-board-config.sh && jq -e '\''.sprintFieldId == 7 and (has("sprintSource")|not) and (has("buildTrackerId")|not) and .swimlaneTrackers == ["Bug", "Story"]'\'' /usr/share/nginx/html/config.json' >/dev/null
docker run --rm --entrypoint /bin/sh -e REDMINE_URL=https://redmine.example.test \
  -e SPRINT_FIELD_ID=7 -e BACKLOG_STATUS_ID=1 -e COLUMN_STATUS_IDS=1,2,3,5 -e SWIMLANE_TRACKERS= redmine-sprint-board:test \
  -c '/docker-entrypoint.d/40-board-config.sh && jq -e '\''.swimlaneTrackers == []'\'' /usr/share/nginx/html/config.json' >/dev/null
docker network create "$network" >/dev/null
for field in '' 0 -1 1.5 invalid; do
  if docker run --rm --entrypoint /bin/sh -e REDMINE_URL=https://redmine.example.test \
    -e BACKLOG_STATUS_ID=1 -e COLUMN_STATUS_IDS=1,2,3,5 -e SPRINT_FIELD_ID="$field" redmine-sprint-board:test \
    -c '/docker-entrypoint.d/40-board-config.sh' >"$tmp/field-error" 2>&1; then
    echo "Invalid Sprint field ID unexpectedly accepted: $field" >&2; exit 1
  fi
done
docker run -d --name "$name-upstream" --network "$network" --network-alias mock \
  -v "$PWD/tests/fixtures/mock-redmine.mjs:/mock.mjs:ro" node:24-alpine node /mock.mjs >/dev/null
docker run -d --name "$name" --network "$network" -p 127.0.0.1::8080 \
  -e REDMINE_URL=http://mock:3000/redmine \
  -e SPRINT_FIELD_ID=7 -e BACKLOG_STATUS_ID=1 -e COLUMN_STATUS_IDS=1,2,3,5 redmine-sprint-board:test >/dev/null
port="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "8080/tcp") 0).HostPort}}' "$name")"
base="http://127.0.0.1:$port"
for attempt in $(seq 1 30); do
  if curl -fsS "$base/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS -D "$tmp/headers" "$base/config.json" | jq -e '.backlogStatusId == 1 and .columnStatusIds == [1,2,3,5] and .redminePublicUrl == "http://mock:3000/redmine" and (.swimlaneTrackers | sort) == ["Bug","Feature","Improvement"]' >/dev/null
grep -qi 'Content-Security-Policy:.*script-src' "$tmp/headers"
grep -qi 'Cache-Control: no-store' "$tmp/headers"
curl -fsS -D "$tmp/proxy-headers" -H 'X-Redmine-API-Key: smoke-key' -H 'Cookie: session=bad' -H 'Authorization: Basic bad' -H 'X-Redmine-Switch-User: admin' "$base/redmine/issues.json?status_id=*" | jq -e '.keyForwarded and (.cookieForwarded|not) and (.authForwarded|not) and (.switchUserForwarded|not) and .path == "/redmine/issues.json?status_id=*"' >/dev/null
! grep -qi 'Set-Cookie:' "$tmp/proxy-headers"
grep -qi 'Content-Security-Policy: sandbox' "$tmp/proxy-headers"
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/redmine/users.json")" == 404 ]]
[[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/redmine/issues.json")" == 404 ]]
curl -fsS -X PUT -H 'Content-Type: application/json' -d '{"issue":{"estimated_hours":1}}' "$base/redmine/issues/1.json" | jq -e '.method == "PUT"' >/dev/null
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/redmine/projects/1.json?include=issue_categories")" == 404 ]]
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/redmine/issues/1/relations.json")" == 404 ]]
[[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/redmine/issues/1/relations.json")" == 404 ]]
[[ "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$base/redmine/relations/1.json")" == 404 ]]
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/redmine/enumerations/issue_priorities.json")" == 404 ]]
[[ "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$base/redmine/issues/1.json")" == 404 ]]
[[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/redmine/projects/1.json")" == 404 ]]
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/redmine/projects/1/issue_categories.json")" == 404 ]]
# Run browser tests against production nginx, including its real CSP.
BOARD_TEST_URL="$base" npm run test:e2e
printf '\nDocker proxy, security headers, runtime config and browser tests passed.\n'
