---
process: validate-story
title: Validate a story
category: Releases
group: Engineering / Releases
tags: release, story
owner: person-casey
backup: person-avery
context: issue, fix_version, disposition:choice(cleared|needs-work)
result: disposition
roles: validator
---

## Assess · DO-CONFIRM {#assess}

- [!] {confirm} ^issue meets its acceptance criteria in ^fix_version @validator {#criteria}
- [ ] {confirm} Tests for the story pass on the release branch @validator {#tests}
- [!] {decide} Is the story ready to ship? @validator {#ready}
  options: cleared, needs-work
  sets: disposition=decision
