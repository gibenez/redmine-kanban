# Redmine issue tags via REST API

Tags come from the `redmine_tags` plugin. A view override (managed by the
ansible `redmine` role) exposes them in the standard issue JSON.

## Endpoints and auth

- Base URL: `...`
- Auth header: `X-Redmine-API-Key: <key>` (never hardcode keys; read from the environment)
- **Quirk:** the `/json/*` path prefix is blocked by the proxy (404). Always use suffix-style endpoints:
  - ✅ `GET /issues.json`, `GET /issues/123.json`
  - ❌ `GET /json/issues.json`

## Reading tags

Every issue object includes a `tags` array of strings (empty array when untagged),
on both the index and show endpoints:

```json
{ "id": 18061, "subject": "...", "tags": ["(447) Adria"] }
```

- `GET /issues.json?project_id=1&limit=100&sort=id:desc`
- `GET /issues/<id>.json`

## Writing tags

Tags are written as a single comma-separated string in `issue.tag_list`
(this is the plugin's attribute name — it is **not** `tags`):

```
POST /issues.json        {"issue": {"project_id": 1, "tracker_id": 2, "subject": "...", "tag_list": "foo, bar"}}
PUT  /issues/<id>.json   {"issue": {"tag_list": "foo, bar"}}
```

Sending `tag_list` replaces the full tag set. Omitting it leaves tags untouched.

## Filtering by tag

The REST API **cannot** filter by tag — the UI's `v[tags][]=...` query param is
silently ignored by the JSON endpoints. To find issues by tag:

1. Fetch issues (`issues.json` with your project/status/sort params), then
2. Filter client-side on the `tags` array.

To list which tags exist in a project (for UI suggestions), use the plugin's
autocomplete endpoint:

```
GET /issue_tags/auto_complete/<project_identifier>?q=<prefix>   → ["tag1", "tag2"]
```

This is an autocomplete endpoint, not a documented full-table REST endpoint.
Before using it as a catalogue, verify that it accepts API-key authentication
and returns all tags for an empty query in the deployed plugin. An empty response
may reflect authentication or suggestion behaviour, not an untagged project.
A full-table picker needs a verified, read-only catalogue endpoint; do not work
around its absence by enumerating every project issue when the picker opens.
