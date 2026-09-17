import { AppLink } from './AppLink';
import { Voyage } from './Voyage';

const GITHUB_URL = 'https://github.com/truecourse-ai/truecourse';

export function CTASection() {
  return (
    <section className="cta" id="cta">
      <div className="wrap">
        <h2>Put your docs to the test.</h2>
        <div className="cta-row">
          <AppLink className="btn btn-primary" placement="cta">
            Get started
          </AppLink>
          <a className="btn" href={GITHUB_URL} target="_blank" rel="noreferrer">
            View on GitHub
          </a>
        </div>
      </div>
      <Voyage />
    </section>
  );
}
