import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export type BlogPost = {
  slug: string;
  title: string;
  /** One-line summary shown in the blog index list. */
  summary: string;
  /** Longer teaser shown on the home-page blog card. */
  excerpt: string;
  tag: string;
  author: string;
  /** Author's profile link (LinkedIn), shown next to the byline. */
  authorUrl?: string;
  /** Human-readable date, e.g. "Jul 21, 2026". */
  date: string;
  /** Machine date for <time>, e.g. "2026-07-21". */
  dateISO: string;
  /** Reading time in minutes. */
  readMinutes: number;
  Body: () => ReactNode;
};

const GITHUB_URL = 'https://github.com/truecourse-ai/truecourse';

function AiMadeWritingCodeCheap() {
  return (
    <>
      <p className="post-lede">
        We analyzed 99 open-source SaaS products to see what changed after a year of AI
        coding adoption. The bugs didn&apos;t go away. Teams are just paying for quality in a
        different way. Here&apos;s the data, and what we&apos;re building to fix it.
      </p>

      <h2>We wanted numbers, not vibes</h2>
      <p>
        Everyone has an opinion about what AI coding agents are doing to software quality. We
        wanted data.
      </p>
      <p>
        So we analyzed 99 open-source B2B SaaS projects: CRMs, ERPs, e-commerce platforms,
        communication tools, analytics products. Think Odoo, Cal.com, PostHog, n8n,
        Mattermost, WooCommerce. We compared the first half of 2025 against the first half of
        2026. Real commits, real pull requests, real bug reports.
      </p>
      <p>A quick note on method, because it matters.</p>
      <p>
        We did not trust GitHub labels to count bugs. Label conventions vary wildly between
        projects, and some projects changed them mid-year. Instead, an LLM read the actual
        content of sampled issues and classified each one: real bug report, or something else
        (feature request, question, chore).
      </p>
      <p>
        To detect AI usage, we looked for co-authorship trailers in commit history, like{' '}
        <code>Co-authored-by: Claude</code>. We searched for fifteen agents in total — Claude,
        Copilot, Codex, Cursor, Devin, OpenCode, Aider, Gemini, Cline, Windsurf, and five more
        — and the first five account for all but a handful of the matches. This only catches
        agents that sign their commits. So every adoption number below is a floor, not a
        ceiling.
      </p>

      <h2>What we found</h2>

      <h3>1. AI adoption exploded.</h3>
      <p>
        Commits co-authored by AI agents went from 220 to 8,260 in one year. That is a 37x
        jump. The number of projects with any AI-agent activity tripled, from 21 to 63 out of
        99.
      </p>

      <h3>2. Bugs did not go away.</h3>
      <p>
        In the 44 repos actively using AI agents (at least 10 AI-co-authored commits in H1
        2026), the bug rate went from 18.9 to 17.7 bugs per 100 commits. That is a 6.4%
        improvement. Better, but small.
      </p>
      <p>
        Put another way: these teams still ship about 1 bug for every 6 commits, in codebases
        where AI now writes a big share of the code.
      </p>
      <figure>
        <img
          src="/blog/chart_bugrate_dark.png"
          alt="Bug rate in AI-adopting repos went from 18.9 to 17.7 per 100 commits, a 6.4% improvement"
          loading="lazy"
        />
        <figcaption>
          Bug rate per 100 commits, AI-adopting repos — H1 2025 vs H1 2026
        </figcaption>
      </figure>

      <h3>3. Merging got slower and PRs got bigger.</h3>
      <p>
        Median PR merge time in those same repos rose from 26.2 to 37.8 hours (+44%). Median
        PR size grew from 68 to 90 lines (+32%). Two thirds of the AI-adopting repos got
        slower at merging, not faster.
      </p>
      <figure>
        <img
          src="/blog/chart_merge_size_dark.png"
          alt="Median PR merge time rose from 26.2 to 37.8 hours (+44%); median PR size grew from 68 to 90 lines (+32%)"
          loading="lazy"
        />
        <figcaption>
          Median PR merge time and PR size, AI-adopting repos — H1 2025 vs H1 2026
        </figcaption>
      </figure>

      <p>Here is the full picture for the 44 repos actively using AI agents:</p>
      <div className="post-table">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>H1 2025</th>
              <th>H1 2026</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Total commits</td>
              <td>64,354</td>
              <td>85,525</td>
              <td>+33%</td>
            </tr>
            <tr>
              <td>Bug rate (bugs per 100 commits)</td>
              <td>18.9</td>
              <td>17.7</td>
              <td>-6.4%</td>
            </tr>
            <tr>
              <td>Median PR merge time</td>
              <td>26.2h</td>
              <td>37.8h</td>
              <td>+44%</td>
            </tr>
            <tr>
              <td>Median PR size (lines changed)</td>
              <td>68</td>
              <td>90</td>
              <td>+32%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>The uncomfortable read</h2>
      <p>Put these three findings together and a picture emerges.</p>
      <p>
        The bug rate stayed roughly flat because merging got slower. Teams absorb bigger,
        AI-assisted changes by spending more human review time on each PR. Quality did not come
        for free. It is being paid for with reviewer hours.
      </p>
      <p>The bottleneck did not disappear. It moved from writing code to checking it.</p>
      <p>
        The real goal is not &quot;fewer bugs&quot; as a slogan. The goal is to keep your
        defect escape rate flat, or better, without slowing down your PRs.
      </p>
      <p>
        Here is the problem with that goal today. CI checks that your code compiles, passes
        lint, and passes the tests you wrote. Your reviewer checks something much harder:
        whether the code still does what the product intended. They do that check in their
        head, from memory, while reading a 600-line diff.
      </p>
      <p>
        That is exactly the check that AI-generated code stresses the most. The code looks
        plausible. It is well formatted. It passes the linter. And it can quietly disagree with
        the spec.
      </p>

      <h2>&quot;But we already have an AI reviewing our PRs&quot;</h2>
      <p>
        Fair question. AI code review tools exist, and many teams already use one. They do
        catch real bugs. The issue is which kind.
      </p>
      <p>
        Bugs come in two classes. The first is code bugs: null dereferences, off-by-one
        errors, race conditions, injection risks. These are wrong no matter what your product
        is supposed to do, and AI reviewers are genuinely useful at catching them.
      </p>
      <p>
        The second class is intent bugs: code that is clean, safe, and internally correct, but
        does the wrong thing. The discount applies to the wrong customer tier. The cancellation
        flow skips a step your docs promise. The API returns a field the spec says was removed.
        Nothing about the code is broken. It just disagrees with what the product intended.
      </p>
      <p>
        An AI reviewer is structurally blind to that second class, because it has no source of
        truth for intent. Your product&apos;s intended behavior lives in PRDs, design docs,
        tickets, and people&apos;s heads. The reviewer sees, at best, the PR description. And
        the PR description was written by the same person, or the same AI, that wrote the code.
        If both are wrong in the same way, the review passes.
      </p>
      <p>
        They are also probabilistic, and they start from zero on every PR. An LLM reviews each
        diff fresh. Different runs produce different comments. Some are sharp, many are
        nitpicks, and teams learn to skim past them. Nothing accumulates. There is no
        persistent record that says &quot;this documented behavior is verified, and stays
        verified.&quot;
      </p>
      <p>
        And they are scoped to the changed lines. Business logic often breaks outside the diff:
        a modified function quietly violates a behavior that is documented, and depended on,
        somewhere else entirely. A diff-scoped reviewer never sees it.
      </p>
      <p>
        There is a deeper problem when the code itself was written by AI. Asking a model to
        review a model&apos;s code is not an independent check. The reviewer shares the
        writer&apos;s blind spots. If the model misunderstood what the feature was supposed to
        do, a second model reading the same context tends to misunderstand it the same way. The
        code looks right to the reviewer for the same reason it looked right to the writer.
      </p>
      <p>
        Verification only works when the check comes from somewhere independent of the thing
        being checked. Tests derived from the spec give you that. A model grading its own
        homework does not.
      </p>
      <p>
        So AI review adds another opinion to the PR. Useful, but it is one more thing a human
        has to adjudicate. What is missing is a gate with ground truth: the spec itself, turned
        into checks that run on every change.
      </p>

      <h2>What we&apos;re building: make the spec part of CI</h2>
      <p>
        This is the problem <Link to="/">TrueCourse</Link> goes after. It is open source, and
        it works like this.
      </p>
      <p>
        <strong>Your docs become a spec corpus.</strong> <code>truecourse spec scan</code>{' '}
        walks the Markdown files you already have: PRDs, ADRs, RFCs, READMEs, design notes. It
        filters out the noise, groups the rest by product area, and flags places where two docs
        contradict each other. (You would be surprised how often they already do.)
      </p>
      <p>
        That conflict detection matters more than it used to. When a human writes code, a stale
        or contradictory doc is an annoyance they route around from memory. When an AI agent
        writes code, the spec is the only source of truth it has to reason from. If two docs
        disagree, the agent picks one, silently, and the choice shows up as a bug two sprints
        later. A coherent spec corpus is not just prep for verification. It is prep for every
        prompt an AI agent reads before it writes a line of code.
      </p>
      <p>
        <strong>Every spec section gets a guard.</strong>{' '}
        <code>truecourse guard generate</code> reads each section that makes a testable claim
        and writes a scenario test bound to that exact section. An LLM writes the test once, up
        front. If the spec and the code already disagree at that moment, you find out
        immediately.
      </p>
      <p>
        <strong>Runs are deterministic. No model in the loop.</strong>{' '}
        <code>truecourse guard run</code> executes the scenarios like a normal test suite. No
        LLM calls. No flakiness. No per-run token bill. A failing scenario means one precise
        thing: this spec section and the code disagree. Maybe the code drifted. Maybe the spec
        is stale. Either way, a gate told you, not a customer.
      </p>
      <p>
        <strong>It works in both directions.</strong> If the code changes, its scenarios fail.
        If a spec section changes, its scenarios go stale and tell you. Your spec becomes a
        living coverage map, where every section carries its own proof and its current status.
      </p>
      <p>
        And yes, an LLM writes each scenario. The difference is what it reads and what it leaves
        behind. It works from the spec section alone, not from the code changes it will later
        judge, so the check comes from an independent source. And its output is not an opinion
        in a PR comment. It is a plain, human-reviewable test, committed to your repo, that runs
        deterministically from then on. Review it once, like any other test a teammate wrote.
        After that, the check is code, not a model&apos;s mood.
      </p>
      <p>
        Today the guard tests CLI tools and APIs: it boots your server or runs your command,
        and checks the real response against the spec. Web, mobile, and desktop UI surfaces are
        next.
      </p>
      <p>
        The point is not to replace human review. The point is to take the part of review
        humans are worst at (holding the whole product spec in their head while reading a big
        diff) and turn it into an automatic check that runs on every PR.
      </p>
      <p>
        Reviewers go back to reviewing design and judgment. The &quot;does this still do what we
        meant?&quot; question gets answered by machinery.
      </p>
      <p>
        That is how you keep the defect escape rate flat without the 44% merge-time tax.
      </p>

      <h2>Here&apos;s what it caught</h2>
      <p>
        We didn&apos;t want to just describe how this works, so we pointed the guard at a real,
        popular open-source API: Cal.com.
      </p>
      <p>
        Cal.com was not a random pick. It is one of the heaviest AI adopters in our sample: 45%
        of its H1 2026 commits are AI-co-authored, the second-highest share of the 99 repos we
        analyzed. Heavy AI usage, and documentation the code no longer follows. The thesis of
        this article, in miniature.
      </p>
      <p>
        Cal.com&apos;s own documentation states that every API response carries three headers:{' '}
        <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code>,{' '}
        <code>X-RateLimit-Reset</code>. The guard read that claim straight out of the docs,
        generated a scenario test asserting it, booted Cal.com&apos;s API v2 server, and ran the
        test against it.
      </p>
      <p>It failed. None of those headers exist.</p>
      <div className="post-table">
        <table>
          <thead>
            <tr>
              <th>Documented header</th>
              <th>Actual response header</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>X-RateLimit-Limit</code>
              </td>
              <td>
                <code>X-RateLimit-Limit-Default</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>X-RateLimit-Remaining</code>
              </td>
              <td>
                <code>X-RateLimit-Remaining-Default</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>X-RateLimit-Reset</code>
              </td>
              <td>
                <code>X-RateLimit-Reset-Default</code>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Every documented name is missing an undocumented <code>-Default</code> suffix. A client
        built by reading the docs, whether a human integrating the API or an AI agent doing the
        same, reads nothing. We confirmed it independently with curl.
      </p>
      <p>
        This isn&apos;t a stale doc nobody noticed. It&apos;s a known issue, open on
        Cal.com&apos;s own tracker since 2023:{' '}
        <a
          href="https://github.com/calcom/cal.diy/issues/12306"
          target="_blank"
          rel="noreferrer"
        >
          calcom/cal.diy#12306
        </a>
        . The guard found it in a single run, from the documentation alone, and pointed straight
        at the section responsible.
      </p>

      <h2>Try it</h2>
      <p>
        TrueCourse is open source and runs locally in your repo. No server, no database, no
        account: results are plain JSON files inside your project.
      </p>
      <pre>
        <code>{`npm install -g truecourse
cd your-repo
truecourse spec scan        # curate your docs into a spec corpus
truecourse guard generate   # author scenario tests bound to spec sections
truecourse guard run        # deterministic: spec vs code, pass or fail`}</code>
      </pre>
      <p>
        A note on cost, since scan and generate call an LLM: before either spends anything,
        TrueCourse shows you a token and cost ceiling and asks you to confirm. The real bill
        lands at or below it. Re-runs only pay for spec sections that actually changed;
        everything unchanged is a cache hit. And <code>guard run</code> is free, every time.
      </p>
      <div className="post-video">
        <iframe
          src="https://www.youtube-nocookie.com/embed/uOGj3rlkOwE?rel=0&cc_load_policy=0&modestbranding=1"
          title="TrueCourse demo"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
      <p>
        Star or contribute on GitHub:{' '}
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">
          github.com/truecourse-ai/truecourse
        </a>
      </p>
      <p>
        Want this as a gate in your CI/CD pipeline, checking spec drift on every PR before
        merge? Want your specs pulled straight from Confluence, Jira, Linear, and Google Docs
        instead of just the Markdown in your repo? That is what the commercial version does.{' '}
        <Link to="/request-access">Join the waitlist</Link>.
      </p>

      <hr />
      <p className="post-note">
        Methodology notes: 99 actively developed open-source B2B SaaS repos across 19
        categories, comparing H1 2025 with H1 2026. &quot;Actively using AI agents&quot; means
        at least 10 AI-co-authored commits in H1 2026; 44 repos met that bar. Bug counts come
        from LLM classification of sampled issue content (up to 100 issues per repo per period),
        scaled to each period&apos;s total issue volume. PR merge time comes from up to 100
        merged PRs per repo per period. PR size comes from evenly spaced samples of merged PRs
        with per-PR line counts. AI usage comes from commit co-authorship trailers; we searched
        fifteen agents (Claude, Copilot, Codex, Cursor, Devin, OpenCode, Aider, Gemini, Cline,
        Windsurf, Amp, Jules, Factory, Roo, Goose) — the first five account for all but 5 of the
        8,260 matched commits. This is a conservative floor, since inline assistants like
        autocomplete leave no trace in commit history.
      </p>
    </>
  );
}

export const posts: BlogPost[] = [
  {
    slug: 'ai-made-writing-code-cheap-reviewing-got-expensive',
    title: 'AI made writing code cheap. Reviewing it just got expensive.',
    summary:
      "We analyzed 99 open-source SaaS products across a year of AI coding. The bugs didn't go away — teams pay for quality in reviewer hours.",
    excerpt:
      "We analyzed 99 open-source SaaS products across a year of AI coding adoption. The bugs didn't go away — teams are just paying for quality in reviewer hours. Here's the data.",
    tag: 'Research',
    author: 'Mushegh Gevorgyan',
    authorUrl: 'https://www.linkedin.com/in/mushgev/',
    date: 'Jul 21, 2026',
    dateISO: '2026-07-21',
    readMinutes: 8,
    Body: AiMadeWritingCodeCheap,
  },
];

export function getPost(slug: string | undefined): BlogPost | undefined {
  return posts.find((p) => p.slug === slug);
}
