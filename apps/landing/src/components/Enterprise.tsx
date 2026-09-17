const SALES_URL = 'mailto:mushegh@truecourse.dev?subject=TrueCourse%20for%20our%20team';

const FACTS: { title: string; body: string }[] = [
  { title: 'Self-hosted', body: 'Runs in your VPC. Code and docs stay with you.' },
  { title: 'Single sign-on', body: 'Okta, Azure AD and Google Workspace.' },
  { title: 'Audit trail', body: 'Every run and decision, timestamped and attributed.' },
  { title: 'Workspaces', body: 'Several teams under one account, each with its own repositories and docs.' },
];

/** What a company needs before it signs: where it runs, who gets in, what is kept. */
export function Enterprise() {
  return (
    <section className="band" id="enterprise">
      <div className="wrap ent">
        <div className="ent-text">
          <p className="kicker">Enterprise</p>
          <h2 className="section-h">Runs where your code lives.</h2>
          <p className="section-sub">
            Self-hosted in your VPC or hosted by us. Every run works on a copy of the repository
            in a machine destroyed when it ends, secrets are encrypted at rest, and nothing about
            your product leaves your account.
          </p>
          <a className="btn btn-primary" href={SALES_URL}>
            Talk to sales
          </a>
        </div>
        <ul className="ent-list">
          {FACTS.map((fact) => (
            <li key={fact.title}>
              <h3>{fact.title}</h3>
              <p>{fact.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
