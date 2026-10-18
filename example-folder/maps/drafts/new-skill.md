---
process: new-skill
title: New skill or process
category: Skills & processes
group: Engineering / AI
tags: ai, skills
owner: person-morgan
context: name
roles: owner
---

## Define · DO-CONFIRM {#define}
- [!] {confirm} Trigger written: when do we use this? @owner {#trigger}
  evidence: note
- [!] {confirm} "Done when" written: how do we know it worked? @owner {#done-when}

## Write the checklist · READ-DO {#map}
- [!] {confirm} Written as a Flightdeck checklist and published @owner {#map-it}
  where: Flightdeck, the process page
  > Checklist first, then the skill. Run it by hand until the steps stop changing.
- [ ] {confirm} Run by hand once, and the checklist fixed where unclear @owner {#tried}

## Gate: Checklist is stable · owner @owner {#stable}

## Build the skill · READ-DO {#build}
- [ ] {run.skill} Skill drafted from the published checklist @owner {#draft-skill}
  skill: skill-builder
  inputs: The published checklist for ^name
- [!] {confirm} Skill declares which checklist version it implements @owner {#implements}
- [ ] {communicate} Team told, with one example @owner {#tell}
  channel: #team
