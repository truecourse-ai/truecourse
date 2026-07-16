# Connecting Confluence to TrueCourse

TrueCourse syncs the pages of one Confluence space into your workspace
Knowledge, classifies which pages carry product/system specifications, and
builds your organization's spec from them. You'll need four values — here's
where each one comes from.

## 1. Site base URL

The address of your Atlassian site, without any path:

```
https://<your-site>.atlassian.net
```

Open Confluence in your browser and copy everything before `/wiki/…`. For
example, if a page's address is
`https://acme.atlassian.net/wiki/spaces/ENG/pages/12345`, the site base URL is
`https://acme.atlassian.net`.

## 2. Space key

The short identifier of the space you want to sync (often 2–5 uppercase
letters). Two ways to find it:

- **From the URL**: open any page in the space — the key is the segment after
  `/spaces/`: `https://…/wiki/spaces/ENG/pages/…` → the key is `ENG`.
- **From space settings**: Space settings → Space details → **Key**.

TrueCourse syncs all current pages of this one space. Pages that don't carry
specification content (meeting notes, templates, status reports) are filtered
out automatically — you don't need to clean the space up first.

## 3. Account email

The email address of the Atlassian account the API token belongs to (next
step). This account needs **read access to the space** — a regular member
account works; admin rights are not required. For production use we recommend
a dedicated service account, so the connection doesn't break when a person
leaves the team.

## 4. API token

Atlassian API tokens are created on the account's profile, not in Confluence:

1. Go to **https://id.atlassian.com/manage-profile/security/api-tokens**
   (sign in as the account from step 3).
2. Click **Create API token**, give it a label (e.g. `TrueCourse`), and
   confirm.
3. **Copy the token immediately** — Atlassian shows it only once.

TrueCourse stores the token encrypted and never displays it again after you
save it.

## Connect it

1. In TrueCourse, open **Settings → Integrations** and click **Configure** on
   the Confluence card.
2. Fill in the four fields and click **Test** — this performs the same read a
   sync uses, so a passing test means syncing will work.
   - *Authentication failed* → check the email/token pair.
   - *No space with key …* → check the space key.
3. **Save**, then click **Sync now** on the Confluence row. Syncing downloads
   the pages and reports what's new — it costs nothing.
4. A **Process** button appears with a summary of what was found. Clicking it
   shows the cost estimate for classifying and consolidating the new content;
   confirm to build your Knowledge. Pages that haven't changed are never
   re-processed, so day-to-day re-syncs are essentially free.

Your pages then appear under **Knowledge → Sources**, and the curated
specification (including any conflicts to resolve) under **Knowledge → Spec**.
