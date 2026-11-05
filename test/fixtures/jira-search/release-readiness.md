---
process: release-readiness
title: Release readiness
context: project, version, sprint, readiness
roles: release-lead
---

## Stories ready for the build · DO-CONFIRM {#stories}
  > Each rule is a Jira search. A rule that finds stories can't be checked: fix them in Jira, then search again.
- [!] {jira.search} The release ^version has stories in it @release-lead {#scope}
  query: project = ^project AND issuetype = Story AND fixVersion = ^version
  results: at least 1
  what: The release's stories, so the rules below don't pass on an empty or misspelled release
- [!] {jira.search} Every story in ^version links to a parent feature @release-lead {#parent}
  query: project = ^project AND issuetype = Story AND fixVersion = ^version AND "Parent Link" is EMPTY
  results: none
  what: Stories in the release with no parent feature
- [!] {jira.search} Every story in ^version has story points @release-lead {#points}
  query: project = ^project AND issuetype = Story AND fixVersion = ^version AND "Story Points" is EMPTY
  results: none
  what: Stories in the release with no story points
- [!] {jira.search} Every story in ^version has product acceptance criteria @release-lead {#criteria}
  query: project = ^project AND issuetype = Story AND fixVersion = ^version AND "Product Acceptance Criteria" is EMPTY
  results: none
  what: Stories in the release with the acceptance criteria field empty
- [!] {jira.search} Every story in ^version has a Jira-test_results attachment @release-lead {#evidence}
  query: project = ^project AND issuetype = Story AND fixVersion = ^version AND issue not in withAttachmentNamed("Jira-test_results*")
  results: none
  what: Stories with no attachment named like Jira-test_results. withAttachmentNamed stands for your Jira add-on's attachment-name function
- [!] {jira.search} Every story in ^version is Done @release-lead {#done}
  query: project = ^project AND issuetype = Story AND fixVersion = ^version AND status != Done
  results: none
  what: Stories in the release that aren't Done
- [!] {jira.search} Every story in sprint ^sprint has fix version ^version @release-lead {#fixversion}
  query: project = ^project AND issuetype = Story AND sprint = ^sprint AND (fixVersion is EMPTY OR fixVersion != ^version)
  results: none
  what: Stories planned in the sprint with no fix version, or another one

## Readiness ticket · DO-CONFIRM {#ticket}
- [!] {jira.search} The readiness ticket ^readiness carries release ^version @release-lead {#ticket-version}
  query: key = ^readiness AND fixVersion = ^version
  results: exactly 1
  what: The readiness ticket, only if its fix version is the release

## Gate: Ready to build · owner @release-lead {#ready}
  approves: building ^version
