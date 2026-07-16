# Connecting Jira to TrueCourse

TrueCourse syncs the issues of one Jira project into your workspace Knowledge,
classifies which issues carry real requirements (stories with acceptance
criteria, product decisions, architecture changes), and folds them into your
organization's spec — alongside Confluence, if you've connected it. You'll
need four values, plus one optional filter.

## 1. Site base URL

The address of your Atlassian site, without any path:

```
https://<your-site>.atlassian.net
```

Open Jira in your browser and copy the origin — for example, from
`https://acme.atlassian.net/jira/software/projects/KAN/boards/1`, the site
base URL is `https://acme.atlassian.net`. (If you also use Confluence on the
same site, this is the same value.)

## 2. Project key

The prefix of the project's issue keys: if your issues look like `KAN-42`,
the project key is `KAN`. You can also see it in **Projects** (the "Key"
column) or in the project's URL: `/jira/software/projects/KAN/…`.

TrueCourse syncs **all standard issues** of the project — epics, stories,
tasks, bugs, in every status (a shipped story is still part of your spec).
Sub-tasks are excluded. You do NOT need to pre-filter: tickets without
specification content (bug reports, dependency bumps, chores) are classified
out automatically and listed as "not included," where you can override any
call.

## 3. JQL filter (optional)

Leave this empty for the default behavior above. If you want to narrow what
gets synced — for example to one label or issue type — enter a JQL fragment;
it is combined with the project scope automatically:

```
labels = spec
issuetype in (Epic, Story)
```

Don't include `project = …` or `ORDER BY` — the project scoping and ordering
are added for you.

## 4. Account email

The email of the Atlassian account the API token belongs to (next step). The
account needs **browse access to the project**; a regular member account
works. For production use we recommend a dedicated service account.

## 5. API token

The same kind of token Confluence uses (one token works for both products on
the same site):

1. Go to **https://id.atlassian.com/manage-profile/security/api-tokens**
   (sign in as the account from step 4).
2. Click **Create API token**, label it (e.g. `TrueCourse`), confirm.
3. **Copy the token immediately** — Atlassian shows it only once.

TrueCourse stores the token encrypted and never displays it again.

## Connect it

1. In TrueCourse, open **Settings → Integrations** and click **Configure** on
   the Jira card.
2. Fill in the fields and click **Test** — it performs the same read a sync
   uses, so a passing test means syncing will work.
   - *Authentication failed* → check the email/token pair.
   - *The value 'X' does not exist for the field 'project'* → check the
     project key.
3. **Save**, then click **Sync now** on the Jira row. Syncing downloads the
   issues and reports what's new — it costs nothing, even for large projects
   (issues are fetched in batches of 100).
4. A **Process** button appears with a summary. Clicking it shows the cost
   estimate for classifying and consolidating the new content; confirm to
   build your Knowledge. Unchanged issues are never re-processed — and note
   that a ticket whose status or assignee changed but whose text didn't
   counts as unchanged.

Your issues then appear under **Knowledge → Sources** (as `KEY: summary`,
deep-linked back to Jira), and the curated specification — including any
conflicts between tickets and other sources, such as a Confluence ADR — under
**Knowledge → Spec**.
