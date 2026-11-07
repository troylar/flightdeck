---
process: release-readiness
title: Release readiness
category: Releases
group: Engineering / Releases
tags: release
owner: person-casey
backup: person-avery
context: fix_version
roles: release-lead
---

## Stories · DO-CONFIRM {#stories}

- [!] {for.each} Validate every release story @release-lead {#each}
  process: validate-story
  items: jira.issue
  pass: issue=item:key, fix_version=^fix_version
  accepts: cleared

## Ship · READ-DO {#ship}

- [!] {confirm} Tag ^fix_version and start the production release @release-lead {#tag}
