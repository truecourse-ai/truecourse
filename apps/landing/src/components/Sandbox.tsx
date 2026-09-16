import { Reveal } from './Reveal';
import { SandboxScreen } from '@/screens/SandboxScreen';

/** How a flow is run: in isolation, on its own data, the machine gone when it ends. */
export function Sandbox() {
  return (
    <section className="band" id="sandbox">
      <div className="wrap">
        <h2 className="eyebrow">Sandbox</h2>
        <div className="hood-text">
          <h3 className="section-title">Every flow runs in isolation.</h3>
          <p>
            TrueCourse boots your product in a fresh machine for each flow, seeds the data that
            flow needs, and destroys the machine when the run ends. Nothing for your team to set
            up or keep running.
          </p>
        </div>
        <Reveal className="diagram" threshold={0.4}>
          <SandboxScreen />
        </Reveal>
      </div>
    </section>
  );
}
