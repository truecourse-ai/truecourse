---
finding: D8
target: AmruthPillai/Reactive-Resume
route: public issue
title: "The set-password dialog is one unlabelled field with no confirmation, and a password below the API's documented minimum is dropped in silence"
labels: "bug, status: needs triage (applied automatically by 1-bug-report.yml); suggested in body: v5, area: account"
status: filed
filed_url: https://github.com/amruthpillai/reactive-resume/issues/3370
filed_at: 2026-08-21
reverified: "yes (main @ 3221afda9ddfb03d6cce87927b0ce47338b4cfa8, which is both the commit our corpus tested and today's default-branch head, so zero commits landed in between; live re-run 2026-08-20 against a self-hosted instance built from that commit: the prompt still holds exactly one input, the words `Confirm` and `6-64` still appear nowhere on the page, and a three character password still closes the dialog leaving `hasPassword` at `false`. The same run added the control that the API genuinely enforces `min(6).max(64)`, which is new evidence the original record did not have)"
format_note: "Matches .github/ISSUE_TEMPLATE/1-bug-report.yml exactly: every required `### ` header present and non-empty, in template order, with the required Existing-issue checkbox ticked. Dropdown sections carry only real option values, verified against the live template on 2026-08-21 (Product variant = Self-hosted; Area = Accounts & sharing). The optional `Template` section is omitted deliberately: the Sharing panel is template-independent and that field's options are template names only. `blank_issues_enabled: false` on this repo, so the form shape is mandatory. Own sub-headings demoted to ####."
---

# The set-password dialog is one unlabelled field with no confirmation, and a password below the API's documented minimum is dropped in silence

### Existing issue

- [x] I searched the existing issues and could not find a matching report.

Keyword searches for the password prompt, the confirmation field and the length rule, plus a sweep of the 800 most recent issues and pull requests, found no match. The nearest neighbour is https://github.com/AmruthPillai/Reactive-Resume/issues/2711 ("[Bug] Public access password issue", closed as completed, labelled `bug` / `status: needs triage` / `v5`), which concerns public-access password behaviour rather than the fields inside the set-password dialog, so it is related and not a duplicate.

One line of overlap worth flagging rather than repeating: the single field in this dialog is also anonymous, which is the accessible-name family already reported at https://github.com/AmruthPillai/Reactive-Resume/issues/3369. It is mentioned once below and is not the subject of this report.

### Product variant

Self-hosted

### Reactive Resume version

5.2.7 (commit `3221afda9ddfb03d6cce87927b0ce47338b4cfa8` on `main`, 16 commits after the `v5.2.7` tag, so this exact build is not a release)

### Area

Accounts & sharing

### Environment

Chromium 141.0.7390.37 (headless, driven by `playwright-core` 1.62.1) on macOS (Darwin 25.5.0, arm64); self-hosted, built from source with `pnpm install --frozen-lockfile` and `pnpm run build`, run as `node apps/server/dist/index.mjs`, PostgreSQL 18 in Docker.

### Summary

The sharing guide describes the set-password step like this, `docs/guides/sharing-your-resume-publicly.mdx:134`:

> Type a password (6-64 characters) and confirm. This password will be required to view your resume.

The dialog that opens from **Set Password** contains exactly one input. There is no second field, the word `Confirm` does not appear anywhere on the page, and neither does the character range the guide quotes.

The part that makes this a product gap rather than a stale sentence in the docs: **the 6 to 64 rule is real and the server enforces it.** `packages/api/src/dto/resume.ts:75` declares the input as `password: z.string().min(6).max(64)`, and the endpoint's own OpenAPI description at `packages/api/src/features/resume/sharing.ts:37` says "The password must be between 6 and 64 characters." A short password is therefore refused with a `400`. The guide is accurate about the constraint; the dialog is the half that does not implement it.

The field does carry `minLength=6` and `maxLength=64` as HTML attributes, passed as `inputProps` from `sharing.tsx:58-61`. They do not help. The prompt is an alert dialog, not a form, and its confirm button is a plain `onClick` handler, so HTML constraint validation never runs and `minLength` is inert. In our run, typing a three character password and pressing **Set Password** closed the dialog, left `hasPassword` at `false`, and told the user nothing about why.

So the dialog implements less validation than the API requires, and it fails quietly rather than saying what went wrong. Two consequences, on a credential that gates access to a published document:

1. A user who types a password shorter than six characters believes it was set. It was not.
2. A user who mistypes has no confirmation field to catch it, on a value that is masked and cannot be read back.

### Steps to reproduce

Self-hosted, signed in, one resume. Every value below is verbatim from our run on 2026-08-20 against resume `d8-82982114`.

1. Open a resume in the builder and expand the **Sharing** section in the right sidebar.
2. Turn on **Allow Public Access**. The public URL, the **Copy URL** button and the **Set Password** button appear. There is exactly one **Set Password** button.
3. Press **Set Password**. The whole prompt, verbatim from Playwright's accessibility tree:

   ```
   - alertdialog "Protect your resume from unauthorized access with a password":
     - heading "Protect your resume from unauthorized access with a password" [level=2]
     - paragraph: Anyone visiting the resume's public URL must enter this password to access it.
     - textbox
     - button "Cancel"
     - button "Set Password"
   ```

   Measured on that dialog:

   ```
   password inputs in the prompt                1
   ALL inputs in the prompt                     1
   inputs on the whole page: before -> after    45 -> 46
   page text contains "Confirm Password"        false
   page text contains "Confirm"                 false
   getByLabel('Confirm Password').count()       0
   page text contains "6-64"                    false
   page text contains "6 to 64"                 false
   ```

   The whole page gained exactly one input, so the missing field is genuinely missing rather than rendered somewhere else.

4. Type a password shorter than six characters. We used `abc`, three characters. Press **Set Password**.

   ```
   prompt still open afterwards:         0
   resume.hasPassword after the attempt: false
   visible feedback line:                "Optionally, set a password so that only people with the
                                          password can view your resume through the link."
   ```

   The dialog closes as if it had worked. The password is not set. The only feedback line our probe could read on the page afterwards is the section's own static hint, which was already there before the attempt.

5. Control, the prompt itself works. It did open and it did render a real `type="password"` input, so what is absent is the confirmation field specifically, not the dialog.

6. Control, the range is genuine and server-enforced. Driving the endpoint directly:

   ```
   PUT /api/openapi/resumes/<id>/password  {"password":"abc"}       -> 400
   PUT /api/openapi/resumes/<id>/password  {"password":"sixchars"}  -> 200
   ```

   The `400` body:

   ```json
   {"defined":false,"code":"BAD_REQUEST","status":400,"message":"Input validation failed",
    "data":{"issues":[{"origin":"string","code":"too_small","minimum":6,"inclusive":true,
                       "path":["password"],
                       "message":"Too small: expected string to have >=6 characters"}]}}
   ```

   So the rule the guide states is the rule the server applies, and the best message the client can surface from that rejection is `Input validation failed`, which never names the range.

### Expected behavior

The dialog should implement the flow the guide already describes:

1. **A confirmation field**, so a mistyped password is caught before it becomes the gate on a published resume. This is the guide's own wording ("Type a password (6-64 characters) and confirm").
2. **The length rule stated in the prompt**, so the user knows the constraint before typing rather than after a failed write.
3. **A short password refused in the dialog**, with a message naming the rule, instead of the dialog closing on a value the API will reject.

The smallest correct fix is the third one. `sharing.tsx:67` already has a client-side guard for the empty string; widening it to the documented range, or having the prompt run `checkValidity()` on its input before resolving, would keep the dialog open and say what is wrong. The confirmation field is the larger ask, and the one the documentation implies.

The fix belongs in the dialog rather than in the guide. `docs/guides/sharing-your-resume-publicly.mdx:134` describes the intended behaviour and the API already agrees with it; editing the sentence away would leave a prompt that still drops short passwords in silence.

### Actual behavior

The prompt holds one unlabelled password field, no confirmation, and no statement of the 6 to 64 rule. A password shorter than six characters closes the dialog, leaves `hasPassword` at `false`, and produces no explanation the user can act on.

#### Cause

Read at `3221afda9ddfb03d6cce87927b0ce47338b4cfa8`.

The prompt is opened with a single field, `apps/web/src/routes/builder/$resumeId/-sidebar/right/sections/sharing.tsx:54-67`:

```tsx
const onSetPassword = useCallback(async () => {
	const value = await prompt(t`Protect your resume from unauthorized access with a password`, {
		description: t`Anyone visiting the resume's public URL must enter this password to access it.`,
		confirmText: t`Set Password`,
		inputProps: {
			type: "password",
			minLength: 6,
			maxLength: 64,
		},
	});
	if (!value) return;

	const password = value.trim();
	if (!password) return toast.add({ type: "error", description: t`Password cannot be empty.` });
```

https://github.com/AmruthPillai/Reactive-Resume/blob/3221afda9ddfb03d6cce87927b0ce47338b4cfa8/apps/web/src/routes/builder/%24resumeId/-sidebar/right/sections/sharing.tsx#L54-L67

The empty-string check on `:67` is the only client-side validation. Everything else is left to the API.

Why the `minLength` attribute does not save it, `apps/web/src/hooks/use-prompt.tsx:124-130` and `:86-90`:

```tsx
<Input
	ref={inputRef}
	value={state.value}
	onKeyDown={handleKeyDown}
	onChange={handleValueChange}
	{...state.inputProps}
/>
```

```tsx
const handleConfirm = React.useCallback(() => {
	if (state.resolve) state.resolve(state.value);

	setState((prev) => ({ ...prev, open: false, resolve: null }));
}, [state.resolve, state.value]);
```

The input sits inside an `AlertDialogContent` with no surrounding `<form>`, and the confirm control is an `AlertDialogAction` wired to `handleConfirm` rather than a submit button. `handleConfirm` resolves and closes unconditionally. HTML constraint validation is never triggered and `checkValidity()` is never called, so `minLength` is decorative. (`maxLength` does bite, because browsers cap typing natively, which is why only the lower bound leaks through.)

Meanwhile the server side is strict, `packages/api/src/dto/resume.ts:75`:

```ts
setPassword: {
	input: resumeSchema.pick({ id: true }).extend({ password: z.string().min(6).max(64) }),
	output: z.void(),
},
```

https://github.com/AmruthPillai/Reactive-Resume/blob/3221afda9ddfb03d6cce87927b0ce47338b4cfa8/packages/api/src/dto/resume.ts#L74-L77

and the endpoint documents the same rule to API consumers, `packages/api/src/features/resume/sharing.ts:37`:

> Sets or updates a password on a resume. When a password is set, viewers of the public resume must enter the password before the resume data is revealed. **The password must be between 6 and 64 characters.** Requires authentication.

So three of the four places agree on 6 to 64: the guide, the DTO and the OpenAPI description. The dialog is the one that does not.

A note on the variant dropdown, since it takes only one value: we drove a **self-hosted** build. The dialog, the prompt hook and the DTO are shared code with no deployment branch of any kind, so the cloud deployment runs the identical path. Please do not read the dropdown as narrowing this to self-hosted installs.

### Logs and screenshots

The single field's attributes, read off the live prompt. Note `ariaLabel: null` and `label: null`, which is the accessible-name issue linked at the top and not the subject here:

```json
[{"type":"password","placeholder":"","ariaLabel":null,"minLength":6,"maxLength":64,"label":null}]
```

The Sharing section immediately before the prompt was opened, so the surrounding state is unambiguous:

```
- region "Toggle Sharing section":
  - switch "Allow Public Access Anyone with the link can view and download the resume." [checked]
  - textbox "URL": http://127.0.0.1:54490/guardowner/d8-82982114
  - button "Copy URL"
  - paragraph: Optionally, set a password so that only people with the password can view your resume through the link.
  - button "Set Password"

'Set Password' buttons: 1
```

No screenshot adds anything here: the decisive facts are the accessibility tree of the dialog, the input count on the page, and the stored `hasPassword` value read back over the API, all quoted above.

#### Suggested labels

`bug`, `status: needs triage` (both applied by the form), plus `v5` and `area: account`. Our account cannot apply labels itself.

Deliberately **no** deployment label: the dialog, the prompt hook and the DTO are shared code with no deployment branch, so narrowing this to either cloud or self-hosted would be wrong.

This finding came from running the product's published documentation against a live instance; the full transcript (the browser session, the complete accessibility snapshots, the short-password attempt and the request and response pairs behind the API control) is available on request.
