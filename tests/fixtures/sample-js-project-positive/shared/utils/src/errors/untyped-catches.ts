// Aggregated fixture for natural rule shape coverage.

// shape cd271ac9: catch-without-error-type — no instanceof/typeof on caught error
export async function performCatchedOp_cd271ac9(): Promise<void> {
  try {
    throw new Error("operation-failed-cd271ac9");
  } catch (e) {
    console.error("caught:", e);
    console.warn("noted");
  }
}


// shape aef98139: catch-without-error-type — no instanceof/typeof on caught error
export async function performCatchedOp_aef98139(): Promise<void> {
  try {
    throw new Error("operation-failed-aef98139");
  } catch (e) {
    console.error("caught:", e);
    console.warn("noted");
  }
}

