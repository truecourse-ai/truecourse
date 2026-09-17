import { Reveal } from './Reveal';
import { SandboxScreen } from '@/screens/SandboxScreen';

/** How a flow is run: in isolation, on its own data, the machine gone when it ends. */
export function Sandbox() {
  return (
    <section className="band" id="sandbox">
      <div className="wrap">
        <h2 className="section-h">Every flow runs in isolation.</h2>
        <p className="section-sub">
          TrueCourse boots your product in a fresh machine for each flow, seeds the data that flow
          needs, and destroys the machine when the run ends. Nothing for your team to set up or
          keep running.
        </p>
        <Reveal className="diagram" threshold={0.4}>
          <SandboxScreen />
        </Reveal>
      </div>
    </section>
  );
}
