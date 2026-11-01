# Updating Flightdeck

> **For:** the person who keeps a team's Flightdeck up to date, usually the team lead.
>
> **You'll get:** seven steps from "is there a new release?" to "the team is on it," what to know for each release from 2.0 to 2.6.1, what to do when computers run different versions, and how to roll back.

One person does this for each team folder, so two updates never cross.

**On this page:** [1. Learn about new releases](updating.md#1-learn-about-new-releases) · [2. Read What's new](updating.md#2-read-whats-new) · [3. Pick a time](updating.md#3-pick-a-time) · [4. Back up](updating.md#4-back-up) · [5. Install](updating.md#5-install) · [6. Verify](updating.md#6-verify) · [7. Tell the team](updating.md#7-tell-the-team) · [When computers run different versions](updating.md#when-computers-run-different-versions) · [Moving to 2.0](updating.md#moving-a-team-to-flightdeck-20) · [2.1](updating.md#what-to-know-when-moving-to-21) · [2.2](updating.md#what-to-know-when-moving-to-22) · [2.3](updating.md#what-to-know-when-moving-to-23) · [2.4](updating.md#what-to-know-when-moving-to-24) · [2.5](updating.md#what-to-know-when-moving-to-25) · [2.6](updating.md#what-to-know-when-moving-to-26) · [2.6.1](updating.md#what-to-know-when-moving-to-261) · [Rolling back](updating.md#rolling-back)

An update has two parts. `flightdeck.html` is the app everyone opens. `AGENTS.md` and the skills in `.flightdeck/skills/` are the contract your team's AI assistants follow. `flightdeck install` updates both, and never replaces a file your team changed without asking.

## 1. Learn about new releases

Flightdeck never checks for updates itself; the app stays offline. Pick one of these:

- Watch [`CHANGELOG.md`](https://github.com/troylar/flightdeck/blob/main/CHANGELOG.md) in the repository. Every release adds its notes there.
- Or now and then, run `npm view @troylar/flightdeck version`. It prints the newest published version. `npm outdated -g @troylar/flightdeck` lists it only when it's newer than the one installed on this computer.

## 2. Read What's new

Read the release's notes (`CHANGELOG.md`, or What's new in the app once installed). The version number gives a rough size: a patch (2.6.0 → 2.6.1) fixes things, a minor (2.5 → 2.6) adds or improves features, a major (1.x → 2.0) adds file formats. It doesn't answer the two questions that matter for a shared folder, so the notes and the sections below do:

**What can an older copy read?** Each published version records the features it uses, in the `features` list Flightdeck writes when it publishes. A copy that doesn't know one of them shows the version and won't run it, and says which Flightdeck it needs ("v5 needs Flightdeck 2.1"). It never changes or damages it. So a new feature matters only once someone publishes a checklist that uses it; the publish panel names those under **Needs Flightdeck 2.x**.

**Must every computer update?** Some fixes protect the shared folder only once every computer that uses it has them, even though no checklist feature changed. 2.1.1's planned-start protection is one: a 2.1.0 copy can still start a plan that 2.1.1 holds (see [What to know when moving to 2.1](updating.md#what-to-know-when-moving-to-21)).

| Release | What older copies can read | Must every computer update? |
|---|---|---|
| 2.0 (major) | Copies from 1.21 on share the folder with 2.0: they show 2.0's files by name and never change them. Copies older than 1.11.1 can't tell (see [Two limits to know](updating.md#two-limits-to-know)). | Yes, in order: every computer on 1.21 first, then 2.0 ([Moving a team to Flightdeck 2.0](updating.md#moving-a-team-to-flightdeck-20)). |
| 2.1 (minor) | A version that uses `only when` runs only on 2.1 and later. Staged versions and test runs are for 2.1 copies; 2.0 shows a test run by name only and counts it as a run. | Before anyone publishes a checklist with `only when` or stages a version. |
| 2.1.1 (patch) | Nothing new to read. | Yes: a planned run starts once only when every computer has 2.1.1. |
| 2.2 to 2.6.1 | Nothing new to read: no checklist feature and no file format changed. | No. Computers can update one at a time. |

## 3. Pick a time

People can keep working during an update, but it's calmer if nobody is recording a run. Ask anyone recording to finish or hand off first, or update together at the start of the day. When the notes say every computer must update (a major release, or a fix like 2.1.1's), everyone stops, you update, and everyone reopens.

## 4. Back up

```bash
flightdeck backup "~/OneDrive/Team/Flightdeck"
```

This copies the whole team folder to `Flightdeck backups` in your home folder, in a new folder named with the date and time. `--to <folder>` puts it somewhere else. It never puts a backup inside the folder it backs up, and it skips links and temporary files. Mark the team folder **Always keep on this device** first, so every file is really on your computer.

## 5. Install

```bash
npm install -g @troylar/flightdeck@latest
flightdeck install "~/OneDrive/Team/Flightdeck" --check
```

`--check` changes nothing. It lists what install would do and ends with an exit code:

| Exit code | Means |
|---|---|
| 0 | Nothing to do |
| 2 | Updates to install |
| 3 | Some files your team changed need merging |
| 1 | A problem (the folder is missing, a file is a link, the folder has a newer Flightdeck) |

Then install:

```bash
flightdeck install "~/OneDrive/Team/Flightdeck"
```

It copies `flightdeck.html`, then goes through `AGENTS.md` and each skill file. **From the app (2.12.0 on):** open the new `flightdeck.html`, then **Settings → AI assistant files** and choose **Update**. It goes through `AGENTS.md` and the skills by exactly the rules below and writes the same record, so the app and the command never disagree; it doesn't change `flightdeck.html` itself. Use the command for scripts, for CI, and to update the app file.

| What install (or the app's Update) finds | What it does |
|---|---|
| Same as this version's default | Nothing |
| An earlier default (exactly a file some Flightdeck version shipped, which the built-in list of defaults proves) | Updates it |
| A file your team changed, when this version didn't change that default | Leaves it alone |
| A file your team changed, when this version changed that default too | Leaves it alone, and puts the new default in `.flightdeck/updates/<version>/` with a `README.md` |
| Missing | Adds it |

In `AGENTS.md`, only the part between `<!-- flightdeck:begin -->` and `<!-- flightdeck:end -->` is Flightdeck's. **Team notes**, below it, are yours, and install never changes them. Put your team's own instructions for AI assistants there. Keep them to about 4 KiB: one tool stops reading the file at 32 KiB unless it's told to read it.

**When files need merging:** in the app, **Copy merge request** on **Settings → AI assistant files**, or open your AI assistant in the team folder and give it the prompt in `.flightdeck/updates/<version>/README.md`. It compares each new default with your file, keeps your changes, brings in the new ones, and deletes each copy once merged. Run `flightdeck install <folder> --check` again; 0 means nothing is left.

A copy left in any version's updates folder (`.flightdeck/updates/<version>/<the file's path>`) still counts as waiting, even after a later update and even if the file now matches the default, until someone deletes it or `--force` files it away. If this version changed that file's default again, its new default is staged in this version's folder too, so you merge both; the file counts as waiting until every copy is gone.

**Install always keeps a copy of every file it replaces** (`AGENTS.md`, skill files and `flightdeck.html`, an earlier default too) in a new folder of its own under `.flightdeck/updates/<version>/replaced/`, and says where. Each copy is written in full and read back before the file is replaced; if that fails, the file isn't replaced.

`--force` replaces files your team changed with the new defaults instead. It also moves any copies still waiting to be merged into that install's own copy folder, `.flightdeck/updates/<version>/replaced/<time>/staged/<the version they were waiting from>/…` (this `staged/` is only a name inside the copy folder, not the team folder's `staged/` versions), including copies for files that already match the default. `--app-only` installs only `flightdeck.html`.

**I merged it** (the app): once a file is merged, it puts each waiting copy of that file away under `.flightdeck/updates/<version>/replaced/<time>/staged/<the version it was waiting from>/…`. The copy is written there and read back first, and the waiting copy is removed only if it's still exactly what the screen read; a copy that changed meanwhile stays where it is, and the screen says so. This is a copy and then a removal, not a move. A change that lands in the instant between that last read and the removal is lost with the waiting copy, the same limit as `--force` on these generated copies.

**A skills folder of its own.** Someone whose AI assistant loads skills from a folder outside the team folder keeps it current with `flightdeck skills --to <folder>`, or with **In another folder** on **Settings → AI assistant files**. It works the same way, with its record in `.flightdeck-installed.json` and new defaults to merge (and copies of replaced files) in `.flightdeck-updates/<version>/`, both beside the skills. `--check` and `--force` work there too.

**What install trusts.** `.flightdeck/installed.json` only ever makes install more careful. Install replaces a file without `--force` only when it's exactly a default Flightdeck shipped; a record that's damaged or wasn't written by Flightdeck is ignored, and install says so.

**A file that changes while the app updates.** The app reads every file again when you choose **Update**, then writes each one only over the exact text it just read, and reads it back. A file that changed in between is left as it is, named on the screen, and keeps its old entry in the record, so the next update looks at it again. The app can't follow links the way the command checks them: it writes only through the folder you chose, to paths built from its own list of files. A save that lands in the instant between the app's last comparison and its write is overwritten, and the copy kept holds the file as it was before the update, not that last save. Close editors on `AGENTS.md` and the skills while you update.

**A file that would get too big.** Flightdeck reads these files up to 8 MB. If the new defaults would take a file past that, Update and `flightdeck install` both refuse before changing anything and say which file. Shorten what your team added to it, then try again.

**A file that changes while install runs.** Just before replacing a file, install reads it again. If it changed since install first read it (an AI assistant saving it, say), install leaves it as it is and ends with exit code 1, so you run it again. A save that lands in the instant between that last read and the replacement is replaced. The copy install kept holds the file as it was before install, not that last save; whatever the save added is only in the program that made it, if it still has it. Close editors on `AGENTS.md` and the skills while you install.

**Links and disk errors.** Install never writes through a link or outside the folder: it checks every folder on the way, writes a new temporary file in full and reads it back, checks again, and then puts it in place in one step. A disk error at any point leaves the file as it was and removes the temporary file. Someone who renames folders inside your team folder at the same instant, on purpose, can still redirect a write; that's outside what a file copy can guard against. Don't run install while something else is reorganizing the folder.

## 6. Verify

Open the team folder's `flightdeck.html` and check What's new shows the new version. Open a run and a process to make sure they load. Then open **Settings → Folder health** and deal with anything under Needs action, and run a **Connection check** with a teammate on another computer (each of you sends one).

## 7. Tell the team

Say that Flightdeck was updated and to reopen it from the team folder's own `flightdeck.html`, not from a copy saved elsewhere or a browser bookmark to a download. Anyone still running an older copy sees "Flightdeck X is in the team folder" in the top bar.

## When computers run different versions

For a while after an update, some people will still have the older copy open. Copies from 1.11.1 on never overwrite what they don't understand:

| A newer copy wrote | An older copy (1.11.1 on) |
|---|---|
| A published version with new step types or syntax | Shows "Update Flightdeck to run it" and won't start it. From 1.21 on it says which version it needs: "v5 needs Flightdeck 2.0" (or 2.1) |
| A run with fields it doesn't know | Opens the run read-only |
| A run in a newer run format (made with Flightdeck 2.0) | Shows its name only and won't change it. From 1.21 on: "Made with Flightdeck 2.0" |
| A staged version or a test run (2.1) | Never lists `staged/`. Shows a test run by name only and won't change it (2.0: "Test run · needs Flightdeck 2.1"), but counts it in Home's running number |
| A plan, a sign-off, a step type or a decision in a newer format | Doesn't use it. From 1.21 on, Folder health lists it with the version it needs |
| A note of a new kind (a correction, read by a copy older than 1.13) | Shows it as a plain note and keeps its files |
| A draft that uses new checklist syntax | Shows errors on the draft; publish it from the newer copy |
| `AGENTS.md`, the skills, `.flightdeck/installed.json` | Ignores them: the app doesn't read them |
| Connection checks in `connection/` (1.15) | Ignores them: copies before 1.15 never read that folder, and can't answer a check |

So the worst case is someone who can't record until they reopen the newer copy. Nothing in the team folder is erased.

### Two limits to know

- **Copies older than 1.11.1 can't tell.** Flightdeck 1.10.0 and 1.11.0 don't check a file's format. With Flightdeck 2.0 files in the folder they leave runs made with 2.0 out of their lists without a word, and they offer a 2.0 version as the latest, as if they could run it. Nobody should use them in a folder where anyone uses Flightdeck 2.0. Folder health (1.21 on) names older copies it saw answering connection checks or editing drafts in the last 7 days.
- **A change an older window couldn't save is lost from that window.** When a newer Flightdeck saves a run while an older window has it open, the older window refuses to save over it and writes nothing, which keeps the team folder safe. But the change made in that window isn't kept on disk. If the window is switched to another folder, the browser keeps a copy, and back in the first folder the older copy shows "A copy kept in this browser" with only a Discard button. That copy isn't a way to get the change back. Re-enter the change in Flightdeck 1.21 or newer (see [An older Flightdeck said it couldn't save](recovery.md#an-older-flightdeck-said-it-couldnt-save)).

### Moving a team to Flightdeck 2.0

1. Put Flightdeck 1.21 in the team folder and have everyone reopen it from there. Check Folder health: "Teammates are using an older Flightdeck" should be gone once every computer has answered a connection check or opened a draft with 1.21.
2. Then put Flightdeck 2.0 in the team folder.
3. Only then start using 2.0 features (notes and screenshots on phases and gates, exact versions of linked checklists and skills, typed run details and evidence, reports from tools). `only when`, staging and test runs are 2.1 features (below). A checklist that uses none of them still publishes as a version every copy from 1.11.1 on can run.

### Using conditions (2.1)

`only when` on a step or phase needs Flightdeck 2.1 on every computer that runs the checklist: a version that uses it shows on 2.0 and earlier as "needs Flightdeck 2.1" and won't start there, and its runs show by name only. Put 2.1 in the team folder and have everyone reopen it before anyone publishes a checklist with `only when`. The 1.21 step above still comes first for a team moving from 1.x; 2.1 doesn't change it. A checklist without `only when` publishes exactly as it does on 2.0.

### Staging and test runs (2.1)

A staged version and its test runs are only for copies on 2.1. Older copies never list `staged/`, show a test run by name only and never change it, but until they update to 2.1 they count a test run in Home's running number, and How runs go and Compare versions list its stage as one more version with the number it proposes. Once that stage is made the default, an older copy shows the stage and the new version as two folders with the same number, marked Clash. Updating to 2.1 fixes both. A version made the default from a stage is an ordinary version: any copy that understands the features it uses can run it, so one with `only when` needs 2.1.

### What to know when moving to 2.1

- **A run open in a browser since before 2.1 makes one conflict copy.** 2.1 compares a run's whole file before saving over it. A run that was already open in a browser tab from before the update has only the older, shorter fingerprint, so its first save keeps your change as a conflict copy instead of writing over the run. Reopen the run and carry on; later saves work as usual.
- **Known issue: plan decisions and edit history still use the shorter fingerprint.** The fingerprint a plan decision records for its plan (`proposalHash`) and the from and to of each History entry stay 32-bit in 2.1, so files already in team folders keep reading. In the rare case two versions of a plan or a file share that fingerprint, those records can't tell them apart.
- **A planned run starts once (2.1.1), once every computer has 2.1.1.** Starting a plan marks it started first, naming its run, and then saves the run. If the run doesn't save, only that window can save it, with **Try again**, so a retry never starts a second run. A start or decline on any version of a plan holds it, so a copy that was edited, or a copy left after the one started was deleted, can't be started again. A 2.1.0 copy still counts a decision only on the plan as it is now, so it can start an edited plan that 2.1.1 holds: put 2.1.1 on every computer that uses the folder.
- **Changed in 2.1.1: a plan that was started or declined can't be started again after someone edits it.** It shows "Decided on an earlier version of this plan", with who decided what and when. Make a new plan instead. Reading for other apps keeps calling it `changed`, and that's final: it never becomes `pending` again.
- **Known issue: two limits remain.** There's no lock across computers: two computers starting the same plan at the same moment can both start it, and Runs shows the plan's decisions as disagreeing; keep one run and cancel the other. And a decision file that was renamed (so its name doesn't start with the plan's ID) and can't be read holds no plan: Folder health names it, and until it reads, its plan could be started again (see [A plan file with another name can't be read](recovery.md#a-plan-file-with-another-name-cant-be-read)).

### What to know when moving to 2.2

- **Nothing in the team folder changes.** Practice lives in your browser tab only: it's never written to the folder and never counted as a run, so computers on 2.1 and 2.2 can share a folder.
- **Staging from Practice is the same stage.** **Stage it for a test run** in Practice writes exactly what **Stage the draft for testing** writes, so copies on 2.1 see it and can test it.
- **A blank new process starts with no steps (2.2.1).** It can't be published or staged until it has one; earlier versions started with a placeholder step to delete.

### What to know when moving to 2.3

- **Nothing in the team folder changes.** Practice now opens the real run screen, marked **Practice · not recorded**, but it still lives in your browser tab only: a `#/practice` link or a reload brings it back in that tab, and it's never written to the folder. Computers on 2.2 and 2.3 can share a folder.
- **Save draft from practice.** While there are unsaved edits, **Save draft** is in the practice header. It saves the draft to the folder as the editor does; a conflict offers Compare in the editor.
- **The editor's button is Review & publish (2.3.1).** It said Done before.
- **Step text shows the run's details (2.3.1).** A step tied to a run detail shows its value on the run screen, Next up, the receipt and reports ("Start the production deploy job v2026.10.16"), and `‹tag›` until it's set. Only what's shown changed: the run file and the checklist stay as they were.

### What to know when moving to 2.4

- **Nothing in the team folder changes.** 2.4 is a new look: controls that answer hover, press and focus, new toggles and fields, the Instrument Sans typeface (inside `flightdeck.html`, so every computer shows the same type), and dark mode with depth. Animations stop when your computer asks for less motion, and switches and selections read in Windows high contrast.

### What to know when moving to 2.5

- **Nothing in the team folder changes.** 2.5 is speed: a folder of thousands of runs opens and refreshes without stalling, and the page stays usable while runs arrive. The sizes Folder health warns about are the same as before (see [The folder is getting big](recovery.md#the-folder-is-getting-big)).

### What to know when moving to 2.6

- **Nothing in the team folder changes.** The step form asks a question for each box, shows only the boxes a step usually needs (the rest behind **+ add** and **More about this step**), and offers short choices as buttons.
- **One Pull request step, the same files.** The editor shows one **Pull request**, whose first question is **Where is the pull request?** (GitHub or Bitbucket). The checklist still says `github.pr` or `bitbucket.pr`, exactly as if you'd written it by hand, so copies before 2.6 read it as before. Switching keeps every value; what Bitbucket doesn't have (the `approve` action, the `pull:` link, recording `checks`) is flagged, and publishing refuses it until it's removed.

### What to know when moving to 2.6.1

- **Nothing in the team folder's runs, versions or other records changes.** 2.6.1 corrects documentation: the AI-assistant instructions (`AGENTS.md` and the skills), and the app's **When something goes wrong** guide.
- **The corrected `AGENTS.md` and skills reach a folder only through install.** The app doesn't update them. One install updates them for every assistant that works in that folder.

**A team folder:**

```bash
npx @troylar/flightdeck@2.6.1 install "~/OneDrive/Team/Flightdeck"
```

- In `AGENTS.md`, only the part between `<!-- flightdeck:begin -->` and `<!-- flightdeck:end -->` is updated. **Team notes**, outside the markers, stay as they are.
- A skill file that's still exactly a default some Flightdeck shipped (one your team never changed) is updated to 2.6.1's.
- A file your team changed stays as it is. 2.6.1's default goes to `.flightdeck/updates/2.6.1/`, at the same path, with a `README.md` holding a prompt for your AI assistant to merge them ([When files need merging](updating.md#5-install)).
- `--app-only` updates only `flightdeck.html`, and leaves `AGENTS.md` and the skills as they are.

**A skills folder of its own** (outside the team folder):

```bash
npx @troylar/flightdeck@2.6.1 skills --to "~/skills"
```

It keeps its record in `.flightdeck-installed.json` and puts new defaults to merge in `.flightdeck-updates/2.6.1/`, beside the skills.

**Until a merge is done,** every install and every `--check` lists that file as needing a merge ("still waiting in updates/2.6.1"), even after a later update. Once your assistant has merged it and deleted its copy, `--check` exits with 0.

### What to know when moving to 2.12

- **Nothing in runs, versions or other records changes.**
- **AGENTS.md and the skills can be updated from the app.** **Settings → AI assistant files** applies the same rules as `flightdeck install` and writes the same `.flightdeck/installed.json` (with `"by": "app"`). An older command reads it as its own.
- **Folder health judges these files by the installer's rules.** A file your team changed on top of an older default is reported as waiting to merge, as `flightdeck install --check` says, where older copies called it current. A record that isn't exactly what Flightdeck writes is reported as one the next update replaces, and a record with any `features` is treated as written by a newer Flightdeck and left alone, by the app and the command alike.

## Rolling back

If an update goes wrong, install the older version over it. For example, from 2.6.1 back to 2.6.0:

```bash
npx @troylar/flightdeck@2.6.0 install "~/OneDrive/Team/Flightdeck" --force
```

`--force` is needed because the folder's `flightdeck.html` is newer than the one you're installing. It also puts back 2.6.0's `AGENTS.md` (between its markers; Team notes stay) and skills, including ones your team changed, after saving a copy of each file it replaces. To roll back only the app, add `--app-only`.

Files the newer version already wrote with features the older one doesn't know (runs, publications) stay read-only to the older copy, as in the table above; 2.6.1 writes nothing 2.6.0 can't read. They aren't lost; they work again once you update. Versions before 1.15 install only `flightdeck.html`; from 1.15 on, `--force` also puts back that version's `AGENTS.md` and skills.

Don't roll back past what the folder already uses:

- never below 1.21 once the folder has files from Flightdeck 2.0 (see [Moving a team to Flightdeck 2.0](updating.md#moving-a-team-to-flightdeck-20) and [Two limits to know](updating.md#two-limits-to-know));
- never below 2.1 once anyone published `only when` or staged a version;
- never below 2.1.1 while plans are being started, since its planned-start protection works only when every computer has it.

If you need the folder exactly as it was, restore your backup instead (see [When something goes wrong](recovery.md#restoring-from-a-backup)).
