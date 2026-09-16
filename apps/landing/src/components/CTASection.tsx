import { AppLink } from './AppLink';
import { Voyage } from './Voyage';

const GITHUB_URL = 'https://github.com/truecourse-ai/truecourse';

export function CTASection() {
  return (
    <section className="cta" id="cta">
      <div className="wrap">
        <p className="kicker">The IDE for product owners</p>
        <h2>
          Put your docs <span className="hl">to the test.</span>
        </h2>
        <div className="cta-row">
          <AppLink className="btn btn-primary" placement="cta">
            Get started <span className="arr">→</span>
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
