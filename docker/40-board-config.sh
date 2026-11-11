#!/bin/sh
set -eu
if [ -n "${SPRINT_SOURCE:-}" ] && [ "$SPRINT_SOURCE" != version ]; then
  echo 'Build-based Sprints are no longer supported. Remove SPRINT_SOURCE and BUILD_TRACKER_ID; existing Redmine data is not migrated.' >&2
  exit 1
fi
: "${REDMINE_URL:?Set REDMINE_URL to your Redmine instance URL, e.g. https://redmine.example.com}"
: "${BACKLOG_STATUS_ID:?Set BACKLOG_STATUS_ID to your New status ID}"
: "${COLUMN_STATUS_IDS:?Set COLUMN_STATUS_IDS to ordered status IDs, e.g. 1,2,3,5}"
: "${SPRINT_FIELD_ID:?Set SPRINT_FIELD_ID to a Version custom field ID}"
# Reject nginx directives, credentials, variables, query strings and malformed ports.
# A path prefix is supported for Redmine deployments under a subdirectory.
printf '%s' "$REDMINE_URL" | grep -Eq '^https?://[a-zA-Z0-9._-]+(:[0-9]+)?(/[a-zA-Z0-9._~-]+)*$' || { echo 'Invalid REDMINE_URL (no trailing slash).' >&2; exit 1; }
jq -en --arg public "$REDMINE_URL" --arg backlog "$BACKLOG_STATUS_ID" --arg field "$SPRINT_FIELD_ID" --arg columns "$COLUMN_STATUS_IDS" --arg refresh "${REFRESH_SECONDS:-60}" --arg lanes "${SWIMLANE_TRACKERS-Feature,Bug,Improvement}" '
  ($backlog | tonumber) as $b |
  ($field | tonumber) as $f |
  ($columns | split(",") | map(tonumber)) as $c |
  ($refresh | tonumber) as $r |
   if ($f > 0 and $f == ($f|floor) and $b > 0 and $b == ($b|floor) and ($c|length) > 0 and all($c[]; . > 0 and . == floor) and ($c|unique|length) == ($c|length) and $r >= 15)
   then {redminePublicUrl: $public, sprintFieldId: $f, backlogStatusId: $b, columnStatusIds: $c, refreshSeconds: $r, swimlaneTrackers: ($lanes | split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(length > 0)) | unique)}
   else error("Invalid status IDs or refresh interval (minimum 15 seconds)") end
' > /usr/share/nginx/html/config.json
