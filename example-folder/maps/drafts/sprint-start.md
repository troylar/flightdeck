---
process: sprint-start
title: Start a sprint
category: Sprints
group: Delivery / Sprints
tags: jira, planning
owner: person-blake
context: sprint
roles: scrum-lead
---

## Before planning · DO-CONFIRM {#before}
- [!] {ui.action} Last sprint closed in Jira @scrum-lead {#close-last}
  system: Jira
- [ ] {confirm} Unfinished stories moved or sent back to the backlog @scrum-lead {#carryover}
- [ ] {confirm} Time off for the next two weeks entered as capacity @scrum-lead {#capacity}
- [~] {ui.action} Sprint dates copied into the team roadmap @scrum-lead {#roadmap}
  system: Team roadmap

## Planning · READ-DO {#planning}
- [!] {meeting} Sprint planning with the whole team @scrum-lead {#meeting}
  attendees: Everyone
  at: 10:00
- [!] {confirm} Sprint goal agreed as one sentence {#goal}
  evidence: note
- [!] {confirm} Every committed story has acceptance criteria {#criteria}

## Gate: Sprint ready · owner @scrum-lead {#ready}
  approves: ^sprint
  due: 12:00

## After planning · DO-CONFIRM {#after}
- [!] {ui.action} Sprint started in Jira ^sprint @scrum-lead {#start}
  system: Jira
- [ ] {communicate} Goal posted in the team channel @scrum-lead {#post}
  channel: #team
