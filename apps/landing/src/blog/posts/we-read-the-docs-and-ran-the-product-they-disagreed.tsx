import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { PostMeta } from '@/blog/types';

export const meta: PostMeta = {
  title: 'We read the docs and ran the product. They disagreed.',
  summary:
    'We pointed TrueCourse at Strapi, Documenso and Cal.diy with nothing but their published docs. Every finding verified against source and trackers: 49 real defects and doc bugs, 41 reported nowhere.',
  excerpt:
    'We pointed TrueCourse at three popular open-source products with nothing but their published docs, then verified every finding by hand against the source and the tracker. 49 real defects and doc bugs, 41 of them reported nowhere, 2 fixed upstream days after the build we tested.',
  tag: 'Research',
  author: 'Mushegh Gevorgyan',
  authorUrl: 'https://www.linkedin.com/in/mushgev/',
  date: 'Aug 15, 2026',
  dateISO: '2026-08-15',
  readMinutes: 13,
  teaserImage: '/blog/findings_teaser_dark.png',
};

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/** Code block whose `# ...` comments are styled as comments. */
function Snippet({ children }: { children: string }) {
  const lines = children.split('\n');
  return (
    <pre>
      <code>
        {lines.map((line, i) => {
          const at = line.search(/(^|\s)#\s/);
          const nl = i < lines.length - 1 ? '\n' : '';
          if (at < 0) return line + nl;
          const cut = at + (line[at] === '#' ? 0 : 1);
          return (
            <span key={i}>
              {line.slice(0, cut)}
              <span className="cmt">{line.slice(cut)}</span>
              {nl}
            </span>
          );
        })}
      </code>
    </pre>
  );
}

export default function Body() {
  return (
    <>
      <p className="post-lede">
        Last month we made a claim. Turn the spec into tests, and you catch the bugs that a
        diff-scoped review misses. This month we put that claim to the test on three real
        products. We gave TrueCourse nothing but their published documentation, ran what it
        generated against a live instance, and then verified every finding by hand, against the
        source and against the issue tracker. Here is what it found.
      </p>

      <h2>The setup</h2>
      <p>
        Three open-source products, picked because they are popular, well documented, and
        expose exactly the surfaces people are wiring AI agents into right now:
      </p>
      <ul>
        <li>
          <strong>
            <Ext href="https://github.com/strapi/strapi">Strapi</Ext>
          </strong>
          , for its brand-new MCP server, admin-token auth, the REST content API and the Content
          Manager.
        </li>
        <li>
          <strong>
            <Ext href="https://github.com/documenso/documenso">Documenso</Ext>
          </strong>
          , for the v2 signing API (envelope, recipients, fields, send, sign) and the web signing
          UI.
        </li>
        <li>
          <strong>
            <Ext href="https://github.com/calcom/cal.diy">Cal.diy</Ext>
          </strong>
          , the community fork of Cal.com, for the v2 bookings and slots API and the public
          booking pages.
        </li>
      </ul>
      <p>
        The pipeline is the one from the{' '}
        <Link to="/blog/ai-made-writing-code-cheap-reviewing-got-expensive">last post</Link>:{' '}
        <code>spec scan</code> reads the product&apos;s own docs, <code>guard generate</code>{' '}
        writes an executable scenario per testable claim, <code>guard run</code> executes them
        against the product. No human wrote a test case.
      </p>
      <p>
        TrueCourse runs all of that on its own. It reads the docs, writes the scenarios, runs
        them, and hands you each failure with its evidence and the doc section it is bound to.
        For this article we went one step further and checked every finding by hand, the way a
        maintainer would check a bug report. We read each failure against the doc sentence it
        cites, traced it to the line of source that misbehaves, found out who changed that line
        and when, searched the project&apos;s tracker for it, open and closed, and checked
        whether anything merged since already fixes it. So every finding below comes with a
        file, a line, a date and a tracker answer.
      </p>
      <p>Each finding is one of three things:</p>
      <ul>
        <li>
          <strong>Real defect.</strong> The product does not do what its docs (or its own
          schema) say, and a user following the docs is harmed.
        </li>
        <li>
          <strong>Doc bug.</strong> The product is sane and intentional, the doc text is wrong.
        </li>
        <li>
          <strong>Edition mismatch</strong> (Cal.diy only). The docs describe the commercial
          Cal.com, and the open-source fork does not ship that feature. Not a defect, but almost
          none of it is written down where a self-hoster would look.
        </li>
      </ul>

      <blockquote>
        <p>
          A word on AI-written code before the numbers, since that was the subject of the last
          post. For some of these bugs we have evidence the change was written with an AI agent,
          in the form of the co-author line the agent leaves on the commit. For the others we
          found no such footprint. We treat all of them the same way. Most of these changes were
          made in the last year or two, by teams with access to the same AI coding and review
          tools everyone has, and those tools missed the bugs. Whether a model or a person typed
          the line matters less than the fact that nothing in the loop was checking the code
          against what the product promised.
        </p>
      </blockquote>

      <h2>The scoreboard</h2>
      <div className="post-table post-table--full">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Defects</th>
              <th>Doc bugs</th>
              <th>Unreported</th>
              <th>Fixed later</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Strapi</td>
              <td>10</td>
              <td>7</td>
              <td>17 of 17</td>
              <td>0</td>
            </tr>
            <tr>
              <td>Documenso</td>
              <td>9</td>
              <td>7</td>
              <td>9 of 16</td>
              <td>1</td>
            </tr>
            <tr>
              <td>Cal.diy</td>
              <td>13</td>
              <td>3</td>
              <td>15 of 16</td>
              <td>1</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        49 findings across the three. 41 of them are on no tracker anywhere. Six of the
        Documenso ones had been noticed independently by one community contributor, whose seven
        docs PRs (
        <Ext href="https://github.com/documenso/documenso/pull/3133">#3133</Ext> through{' '}
        <Ext href="https://github.com/documenso/documenso/pull/3139">#3139</Ext>) have sat
        unmerged since late July. Two were fixed upstream after the build we tested, and both
        come up below. Cal.diy also produced thirty edition mismatches, counted separately and
        explained in its section.
      </p>

      <h2>Strapi: the bugs that shipped with its new MCP server</h2>
      <p>
        We found ten real defects in Strapi. Seven of them are in code that is only months old,
        the April to June 2026 work that added the MCP server and admin-token permissions. The
        other three are older and had simply never been noticed. None of the ten was on
        Strapi&apos;s tracker. Here are two of them, both on the MCP server, and one small one
        we did not expect.
      </p>

      <h3>Admin-token permissions are deleted at every restart</h3>
      <p>
        Strapi&apos;s{' '}
        <Ext href="https://docs.strapi.io/cms/features/admin-tokens">Admin tokens</Ext> page
        opens its Configuration section with a simple promise:
      </p>
      <blockquote>
        <p>
          Admin tokens are configured entirely from the admin panel. No code-based configuration
          is specific to Admin tokens.
        </p>
      </blockquote>
      <p>
        TrueCourse turned that sentence into a scenario and bound it to the section it came
        from. Abbreviated, this is the file it committed (the real one has the same seven steps,
        each with its full request body and a note explaining what it is for):
      </p>
      <Snippet>{`binds:
- doc: docs.strapi.io/cms/features/admin-tokens.md
  section: admin-tokens/configuration
steps:
- boot: { expect: { ready: true } }
- request: POST /admin/login                          # the seeded admin's session
- request: POST /admin/admin-tokens                   # mint a token of our own
    adminPermissions: [{ action: plugin::content-manager.explorer.read,
                         subject: api::article.article }]
  expect: { status: 201 }
- request: PUT /admin/admin-tokens/\${tokenId}         # configure it the way the panel does
  expect: { json: { data.adminPermissions[0].action:
                    { equals: plugin::content-manager.explorer.read } } }
- request: POST /mcp  tools/list                      # control: the grant took effect
  expect: { body: { contains: '"name":"list_article"' } }
- boot: { expect: { ready: true } }                   # restart, change nothing else
- request: POST /mcp  tools/list                      # the same question again
  expect: { body: { contains: '"name":"list_article"' } }`}</Snippet>
      <p>
        Then it booted Strapi from source in a sandbox with a seeded database and walked the
        steps, recording every request and response. The transcript for the last four:
      </p>
      <Snippet>{`step 4  PUT  /admin/admin-tokens/10                     200
        adminPermissions: [explorer.read on api::article.article]
step 5  POST /mcp   tools/list                          200
        tools: list_article, get_article
step 6  boot the server                                 healthy
step 7  POST /mcp   tools/list                          200
        tools: []

mismatch (step 7)
  expected: body contains "name":"list_article"
  actual:   {"result":{"tools":[]},"jsonrpc":"2.0","id":2}`}</Snippet>
      <p>
        The token still authenticates. It can just no longer do anything. No error, no log
        line, and the panel simply shows the permission unchecked. An MCP agent or a CI token
        configured this way dies at the next deploy, crash or supervisor bounce.
      </p>
      <p>
        The reason is a collision between old code and new. Strapi&apos;s boot runs a
        permission cleanup (
        <Ext href="https://github.com/strapi/strapi/blob/c43e9ee1e20f613b63f8f10d9e52be062a8b4a72/packages/core/admin/server/src/services/permission/queries.ts#L90-L187"><code>packages/core/admin/server/src/services/permission/queries.ts:90-187</code></Ext>) that
        deletes any permission row whose properties are all nil. That rule is from 2021 and is
        correct for role permissions, which the panel always writes with a{' '}
        <code>fields</code> property. Admin tokens, added by{' '}
        <Ext href="https://github.com/strapi/strapi/pull/25657">PR #25657</Ext> in April, store{' '}
        <code>properties: {'{}'}</code> on purpose (nil means &quot;all fields&quot; at request
        time). On a localized content type both <code>fields</code> and <code>locales</code>{' '}
        are nil, so the reaper eats the row. Not fixed on <code>develop</code> as of
        mid-August, and not on Strapi&apos;s tracker.
      </p>

      <h3>A database error hands the client the raw SQL</h3>
      <p>
        The second one we did not go looking for. Strapi&apos;s{' '}
        <Ext href="https://docs.strapi.io/cms/features/strapi-mcp-server">MCP server</Ext> page
        lists about twenty filter operators the <code>list</code> tool accepts (<code>$eq</code>,{' '}
        <code>$contains</code>, <code>$null</code> and so on), so TrueCourse wrote a scenario
        that tries each one. To have something to filter, that scenario first creates three
        articles through the MCP <code>create_article</code> tool:
      </p>
      <Snippet>{`binds:
- doc: docs.strapi.io/cms/features/strapi-mcp-server.md
  section: mcp-server/usage/content-management-through-prompts/filtering
steps:
- request: POST /admin/login                          # the seeded admin's session
- request: POST /admin/admin-tokens                   # mint a token of our own
- request: PUT  /admin/admin-tokens/\${tokenId}         # give it read + create on articles
- request: POST /mcp  tools/call create_article       # authorName: "TCRef-Writer"
- request: POST /mcp  tools/call create_article       # authorName: "tcref-writer"
- request: POST /mcp  tools/call create_article       # no authorName, for $null / $notNull
- request: POST /mcp  tools/call list_article         # then one step per operator ...`}</Snippet>
      <p>
        In one run, the third of those creates hit a database hiccup. That happens. What matters
        is what the MCP server sent back to the client:
      </p>
      <Snippet>{`step 6  POST /mcp  tools/call create_article             200
        {"result":{"content":[{"type":"text","text":
          "Tool \\"create_article\\" execution failed:
           insert into \`articles\` (\`created_at\`, \`created_by_id\`, \`document_id\`,
             \`locale\`, \`published_at\`, \`title\`, \`updated_at\`, \`updated_by_id\`)
           values ('2026-08-14 15:09:10.320', 2, 'nez829w0fwk50nas8b6n5df9', 'en',
             NULL, 'tcref-op-gamma-3d73b4faba', '2026-08-14 15:09:10.320', 2)
           returning \`id\` - database is locked"}],
         "isError":true}}`}</Snippet>
      <p>
        The full statement. Table and column names, the internal user id, every bound value,
        handed to whoever holds the token, and a read-only token is enough. On a unique-constraint
        violation the values can be other people&apos;s data. The same database error, hit
        through Strapi&apos;s ordinary REST API, comes back as a plain 500 with no detail. Only
        the MCP path leaks.
      </p>
      <p>
        This is not a documented behavior anyone broke. It is code doing the opposite of what it
        says it does. Every MCP tool runs inside a wrapper whose own comment says errors are
        logged in full on the server and returned to the client as a &quot;safe error
        response (no stack trace leak)&quot;. The logging half is true. The reply half is not.{' '}
        <Ext href="https://github.com/strapi/strapi/blob/c43e9ee1e20f613b63f8f10d9e52be062a8b4a72/packages/core/core/src/services/mcp/tool-registry.ts#L104-L113"><code>tool-registry.ts:104-113</code></Ext>{' '}
        formats the reply as <code>{'`Tool "${name}" execution failed: ${error.message}`'}</code>,
        and the database driver&apos;s message is the whole SQL statement. Introduced with the MCP
        server itself (<Ext href="https://github.com/strapi/strapi/pull/26371">PR #26371</Ext>,
        May 2026). One line to fix.
        Not on Strapi&apos;s tracker.
      </p>
      <h3>And the small stuff</h3>
      <p>
        Not everything it finds is that serious, and that is fine too. The same run noticed
        that the bulk-unpublish confirmation dialog in the Content Manager says
        &quot;Confirm&quot; where the docs tell the user to click &quot;Unpublish&quot; a second
        time. Trivial to fix, and exactly the kind of small inconsistency that makes someone
        following the docs hesitate. Nowadays it is important to catch this type of bug too, to
        avoid the inconsistencies AI can introduce.
      </p>
      <figure>
        <img
          src="/blog/strapi-bulk-unpublish-dialog.png"
          alt="Strapi Content Manager bulk unpublish confirmation dialog showing Cancel and Confirm buttons, no Unpublish button"
          loading="lazy"
        />
        <figcaption>
          The docs say click &quot;Unpublish&quot; again in the dialog. The dialog says
          &quot;Confirm&quot;. Its sibling, bulk publish, does say &quot;Publish&quot;.
        </figcaption>
      </figure>

      <h3>Strapi, in short</h3>
      <p>
        Seventeen findings, and we told you three. A behavior bug, a documented feature that
        silently stops working. A security bug, an error path that leaks what it should hide.
        And a small UI inconsistency that sends a user following the docs looking for a button
        that is not there. Most of the rest are the MCP server again, relation writes that
        silently drop or misreport what they did, plus a handful of pages where the docs describe
        a product that no longer exists.
      </p>
      <p>
        None of them shows up in a crash, a log line, or a failing test suite. All of them
        showed up the moment the docs were read as a checklist.
      </p>

      <h2>Documenso: fixed after the release, when TrueCourse would have caught it before</h2>
      <p>
        In Documenso we found nine real defects and seven doc bugs, all in the v2 signing API
        and the web signing UI, the surface any integration drives to get a document signed.
        Nine of the sixteen are on no tracker. Six are the community PRs from the scoreboard,
        still unmerged. And one had already been fixed
        upstream by the time we looked, in a way that says more about how software actually
        ships than any of the others. That is the one to start with.
      </p>

      <h3>A limit of 100 in the release, 1000 in the docs</h3>
      <p>
        Documenso&apos;s{' '}
        <Ext href="https://docs.documenso.com/docs/developers/api/rate-limits">Rate limits</Ext>{' '}
        page states the budget in one line, and{' '}
        <Ext href="https://docs.documenso.com/docs/developers/getting-started/first-api-call">
          Your first API call
        </Ext>{' '}
        and the workflow examples repeat it:
      </p>
      <blockquote>
        <p>Limit: 1000 requests per minute per IP address. Response: 429 Too Many Requests.</p>
      </blockquote>
      <p>
        The scenario is two steps: the first proves the headers exist at all, the second checks
        the number the docs give:
      </p>
      <Snippet>{`binds:
- doc: docs.documenso.com/docs/developers/api/rate-limits.md
  section: rate-limits
steps:
- request: GET /api/v2/envelope
  expect: { status: 200,
            headers: { x-ratelimit-limit:     { matches: "^[0-9]+$" },
                       x-ratelimit-remaining: { matches: "^[0-9]+$" },
                       x-ratelimit-reset:     { matches: "^[0-9]+$" } } }
- request: GET /api/v2/envelope
  expect: { headers: { x-ratelimit-limit: { equals: "1000" } } }`}</Snippet>
      <p>
        Step 1 passed, the headers are there. Step 2 did not.
      </p>
      <Snippet>{`step 2  GET /api/v2/envelope                            200
        x-ratelimit-limit: 100

mismatch (step 2)
  expected: header x-ratelimit-limit equals "1000"
  actual:   header x-ratelimit-limit was "100"`}</Snippet>
      <p>
        The build hardcodes <code>max: 100</code> in{' '}
        <Ext href="https://github.com/documenso/documenso/blob/3cf2963cd03d8b24770b7490bdb20e596baa5d65/packages/lib/server-only/rate-limit/rate-limits.ts#L91-L95"><code>packages/lib/server-only/rate-limit/rate-limits.ts</code></Ext>.
        Documenso has since fixed it.{' '}
        <Ext href="https://github.com/documenso/documenso/pull/3081">PR #3081</Ext> raised the
        code and the docs to 1000 together, and the hosted product already runs it. But that fix
        is not in any release. Every tagged version, including the newest, still enforces 100,
        and the docs a self-hoster reads while installing it say 1000.
      </p>
      <p>
        We like this one because it is what spec drift looks like when nothing is checking for
        it. The docs moved. The release did not. Nobody wrote a test for the number,
        because who would. The guard read the number off the page and checked it, and the
        mismatch it found is exactly the one a self-hoster hits when they size a client to the
        docs and get throttled at ten percent of the budget.
      </p>

      <h3>A sent document is supposed to be frozen. It is not.</h3>
      <p>
        This is the rule every e-signature product lives by, and Documenso states it three
        times, on the{' '}
        <Ext href="https://docs.documenso.com/docs/concepts/document-lifecycle">Document
        lifecycle</Ext> page, in the{' '}
        <Ext href="https://docs.documenso.com/docs/developers/api/documents">Documents API</Ext>{' '}
        reference, and in the user guide for adding recipients:
      </p>
      <blockquote>
        <p>
          You cannot modify the document content, recipients, or fields while it is pending.
        </p>
      </blockquote>
      <p>
        The scenario builds a document from a template, adds a signer and a signature field,
        sends it, confirms it is now PENDING, and then tries every change the docs forbid,
        expecting each one to be refused:
      </p>
      <Snippet>{`binds:
- doc: docs.documenso.com/docs/concepts/document-lifecycle.md
- doc: docs.documenso.com/docs/developers/api/documents.md
- doc: docs.documenso.com/docs/users/documents/add-recipients.md
steps:
- request: POST /api/v2/envelope/use                  # create a document from the seeded template
- request: POST /api/v2/envelope/update               # sequential signing order
- request: POST /api/v2/envelope/recipient/create-many  # one signer
- request: POST /api/v2/envelope/field/create-many      # one signature field
- request: POST /api/v2/envelope/distribute             # send it
- request: GET  /api/v2/envelope/\${envId}
  expect: { json: { status: { equals: "PENDING" } } }  # control: it is sent
- request: POST /api/v2/envelope/recipient/create-many  # add a second signer, after sending
  expect: { status: 400 }
- request: POST /api/v2/envelope/recipient/update-many  # change the first signer's email
  expect: { status: 400 }
  ...                                                   # delete a recipient, add a field, ...`}</Snippet>
      <p>
        Steps 1 to 6 passed. The document exists, it has been sent, it is PENDING. Step 7 was
        the first forbidden change.
      </p>
      <Snippet>{`step 7  POST /api/v2/envelope/recipient/create-many          200
        {"data":[{"envelopeId":"envelope_urehkhlnlvltdbhv","role":"SIGNER",
                  "email":"tcref-late-6f2f321c45@documenso.test",
                  "signingStatus":"NOT_SIGNED","token":"9Pfx8Fnn0S32rwYhyOfL5", ...}]}

mismatch (step 7)
  expected: status 400
  actual:   status 200`}</Snippet>
      <p>
        A new signer, persisted, with a live signing token, on a document the existing signers
        agreed to under a fixed party list. The API said yes and returned the row. Nothing about
        the document&apos;s status stopped it, and nothing told anyone.
      </p>
      <p>
        The reason sits in{' '}
        <Ext href="https://github.com/documenso/documenso/blob/3cf2963cd03d8b24770b7490bdb20e596baa5d65/packages/lib/server-only/recipient/create-envelope-recipients.ts#L62-L74"><code>packages/lib/server-only/recipient/create-envelope-recipients.ts:62-74</code></Ext>.
        The service has two gates. One rejects the change if the document is already completed.
        The other looks like a status check but only applies to envelopes with advanced
        (AES/QES) signatures and returns immediately for a normal one. Nothing on the path asks
        whether the document is still a draft. The same two-gate shape is in recipient update
        and delete and in field create and update, so the scenario&apos;s next steps, changing
        the first signer&apos;s email, deleting a recipient, adding a field to the sent document,
        would all have gone through the same way. Introduced with the recipient endpoints in
        January 2025 (<Ext href="https://github.com/documenso/documenso/pull/1572">PR #1572</Ext>).
        Not on Documenso&apos;s tracker, not fixed on <code>main</code>.
      </p>
      <p>
        One more detail about that PR. It was reviewed, by CodeRabbit, which left thirteen
        comments and was the only reviewer on it. None of the comments is about the missing
        check, and there is no reason one should be. An AI code reviewer reads the diff and asks
        whether the code is well written. It has no way to know that three pages of the
        product&apos;s own docs promise a sent document cannot change, because that promise is
        not in the diff. That is the difference between reviewing code and verifying it. To
        catch this kind of bug you have to start from the spec, and turn what it promises into
        something that runs.
      </p>
      <h3>Documenso, in short</h3>
      <p>
        Sixteen findings, and we told you two. A limit the docs put at ten times what the
        shipped release enforces, fixed upstream but not released. And a core rule of the
        product, stated three times in the docs, that the API does not enforce, which passed an
        AI code review because the rule was never in the diff. The rest are the same shape,
        writes that answer 200 and quietly do the wrong thing, and seven doc pages that describe
        request and response shapes the API never had.
      </p>

      <h2>Cal.diy: what happens when the docs are for a different edition</h2>
      <p>
        Cal.diy is what Cal.com&apos;s open-source code became this spring. Cal.com split its
        product in two. The commercial version, the one running at cal.com, moved to a private
        repository. What stayed public was renamed Cal.diy, the community edition, &quot;with all
        enterprise/commercial code removed&quot;, and the old public repository now just points
        at it. The docs at cal.com, though, still describe the commercial product. We knew that
        going in, and it turned the Cal.diy run into a different kind of test. Could we tell
        &quot;the fork does not ship this&quot; apart from &quot;this is broken&quot;?
      </p>
      <p>
        It could, and the split is instructive. Thirty documented behaviors turned out to be
        Cal.com-only. Most of them come down to one thing. The public API reference describes a
        newer version of the bookings API than Cal.diy ships, so a self-hoster following it gets
        confusing errors, a drift that has been open on Cal.diy&apos;s tracker as{' '}
        <Ext href="https://github.com/calcom/cal.diy/issues/28762">#28762</Ext> since April.
        The rest are features the fork removed. None of that is a bug. All of it is a page a
        self-hoster reads and cannot follow.
      </p>
      <p>
        Underneath the edition gap we found 13 real defects and 3 doc bugs in Cal.diy, 15 of them
        on no tracker. Here are two of them, one from the booking page and one from the API.
      </p>

      <h3>The out-of-office day that stays fully bookable</h3>
      <p>
        Cal.com&apos;s help centre explains{' '}
        <Ext href="https://cal.com/help/availabilities/out-of-office">Out of office</Ext> in
        plain terms:
      </p>
      <blockquote>
        <p>
          Out of office (OOO) lets you mark periods where you&apos;re unavailable so people
          can&apos;t book you. Each reason has an emoji that shows on your booking page during
          the OOO period. The entry appears in your list and immediately blocks new bookings for
          that date range.
        </p>
      </blockquote>
      <p>
        The seeded host has an out-of-office entry covering 12 June 2030. The scenario opens the
        public booking page for that month and looks for what the docs describe, the day marked
        with the reason&apos;s emoji, disabled, with no slots on offer.
      </p>
      <Snippet>{`binds:
- doc: cal.com-help/help/availabilities/out-of-office.md
  section: out-of-office/add-an-out-of-office-entry
steps:
- navigate: /reference-host/ooo-consult?month=2030-06
  expect: { state: { role: button, name: "🏝️", disabled: true } }
- expect: { visible: { role: button, name: "🏝️" } }
- expect: { text: { matches: "^(?!...Back on the fifteenth...)" } }   # the OOO note stays private`}</Snippet>
      <p>
        Step 1 found no such button. Day 12 rendered as an ordinary, selectable day, and this
        is the screenshot it took:
      </p>
      <figure>
        <img
          src="/blog/caldiy-ooo-day-bookable.png"
          alt="Cal.diy public booking page for the OOO Consult event type on Wednesday 12 June 2030, the host's out-of-office day, showing six bookable time slots and no out-of-office marker"
          loading="lazy"
        />
        <figcaption>
          Cal.diy, the host&apos;s out-of-office day. Six bookable slots, no emoji, no note.
        </figcaption>
      </figure>
      <p>
        The out-of-office calculation (
        <Ext href="https://github.com/calcom/cal.diy/blob/038381aeca6261635357957d66b8ba85cdb29737/packages/features/availability/lib/getUserAvailability.ts#L744-L755"><code>packages/features/availability/lib/getUserAvailability.ts:744-755</code></Ext>) skips
        any OOO day whose weekday is not in the union of the host&apos;s weekly availability
        rows. Date-override rows carry no weekdays. So a host whose bookable days come from date
        overrides, which is exactly what this corpus seeds, gets an empty out-of-office map, and
        the day is open. The same guard was copied into the Holidays feature, so public holidays
        inherit the hole. The code is older than the fork and the fork did not touch it, so this
        one is not Cal.diy&apos;s doing. Unreported.
      </p>

      <h3>The endpoint that says &quot;success&quot; and does nothing</h3>
      <p>
        The API reference for{' '}
        <Ext href="https://cal.com/docs/api-reference/v2/bookings/reassign-a-booking-to-a-specific-host">
          reassigning a booking to a specific host
        </Ext>{' '}
        is one sentence long:
      </p>
      <blockquote>
        <p>Currently only supports reassigning host for round robin bookings.</p>
      </blockquote>
      <p>
        So the scenario books a plain, non-round-robin event type and asks to reassign it, both
        ways the reference offers, expecting to be refused:
      </p>
      <Snippet>{`binds:
- doc: cal.com-docs/docs/api-reference/v2/bookings/reassign-a-booking-to-a-specific-host.md
- doc: cal.com-docs/docs/api-reference/v2/bookings/reassign-a-booking-to-auto-selected-host.md
steps:
- request: POST /v2/bookings                            # a plain booking on the seeded host
  capture: { plainUid: data.uid }
  expect: { status: 201 }
- request: POST /v2/bookings/\${plainUid}/reassign/{{fixture:host.id}}
  expect: { json: { status: { equals: "error" } } }
- request: POST /v2/bookings/\${plainUid}/reassign
  expect: { json: { status: { equals: "error" } } }`}</Snippet>
      <p>Step 2 answered:</p>
      <Snippet>{`step 2  POST /v2/bookings/{uid}/reassign/1                  200
        {"status":"success",
         "data":{"bookingUid":"...",
                 "reassignedTo":{"id":1,"name":"Reference Host", ...}}}

mismatch (step 2)
  expected: json status equals "error"
  actual:   json status was "success"`}</Snippet>
      <p>
        Two hundred, success, and a <code>reassignedTo</code> naming the host the booking
        already had. Nothing happened. When the fork removed the enterprise round-robin engine
        it kept API v2&apos;s dependency on it and satisfied it with stubs (
        <Ext href="https://github.com/calcom/cal.diy/blob/038381aeca6261635357957d66b8ba85cdb29737/packages/platform/libraries/index.ts#L125-L150"><code>packages/platform/libraries/index.ts:125-150</code></Ext>):
      </p>
      <Snippet>{`export async function roundRobinReassignment(_args: { ... }): Promise<void> {
  // No-op in community edition
}`}</Snippet>
      <p>
        The tell is that the four sibling stubs in the same block throw &quot;not available in
        community edition&quot;. Only the two reassign stubs return a silent success, and the
        route, the service and the success-shaped response around them are unchanged. Any
        integration that trusts the envelope believes a host handoff happened. This one is
        Cal.diy&apos;s alone, and it is not on its tracker. The commit that left the stubs
        behind, the fork commit itself, carries a Devin AI co-author line.
      </p>
      <h3>Cal.diy, in short</h3>
      <p>
        Sixteen findings once the edition gap is set aside, and we told you two. A documented
        feature, out of office, that a booker can walk straight through. And an endpoint that
        reports success and does nothing, which is the fork&apos;s own. The rest are the same
        kind of thing, a pending booking that gets auto-confirmed on reschedule, a slot hold
        anyone can extend, a reservation the next read does not see. One of them, a documented
        prefill that never reaches the phone field, was fixed on <code>main</code> five days
        after the commit we tested (
        <Ext href="https://github.com/calcom/cal.diy/pull/29740">PR #29740</Ext>), in no release
        yet.
      </p>

      <h2>Why this is not another AI code review</h2>
      <p>
        Everything above was found on code that had already been reviewed, merged and released,
        and in at least one case reviewed by an AI code review tool as well. The bugs went
        through anyway, because none of them is visible in a diff. A missing status check looks
        like clean code. A hardcoded 100 looks like a constant. You only see the bug if you know
        what the product promised, and the promise lives in the docs, not in the pull request.
      </p>
      <p>
        That is the difference. An AI code reviewer starts from the change and asks whether it
        is well made. TrueCourse starts from the specification and asks whether the product
        still does what it says, with scenarios that run against the real product like any other
        test suite. We ran it after the fact, on released code. On every pull request, the
        Documenso freeze check fails the day PR #1572 is opened, and the Strapi permission wipe
        fails in April, months before anyone noticed.
      </p>
      <p>
        That pull-request gate is what we are building, and it is not open to everyone yet. We
        are putting it on a small number of teams&apos; repos first, with their own docs as the
        spec. If you want your product held to what your documentation promises, on every
        change, ask for access and tell us which repo.
      </p>
      <p>
        <Link className="btn btn-primary" to="/request-access">
          Request access <span className="arr">→</span>
        </Link>
      </p>

      <hr />
      <p className="post-note">
        Methodology notes. Runs on 2026-08-13 and 2026-08-14 against Strapi 5.52.0 (
        <code>develop</code> @ <code>c43e9ee1e2</code>), Documenso 2.16.0 (
        <code>3cf2963</code>) and Cal.diy (<code>calcom/cal.diy</code> <code>main</code> @{' '}
        <code>038381aeca</code>), each run from source in a sandbox with a seeded database. Every
        finding was verified against its evidence bundle, the bound doc page, and the tested
        source. Verdicts come from evidence plus source reading, not from a live re-run.
        &quot;Fixed after&quot; was checked against each upstream default branch as fetched on
        2026-08-15 and against tags. Tracker searches were bounded to three per finding.
        &quot;Distinct&quot; findings count one defect once even when several scenarios hit it.
        Cal.diy&apos;s commercial upstream is not public, so &quot;fixed in Cal.com&quot; could
        not be verified from source.
      </p>
    </>
  );
}
