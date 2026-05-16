
// shape: .then() callback is async to obtain arrayBuffer from a Promise-returning method; async is redundant but intentional — res.arrayBuffer() already returns a Promise
declare const appBaseUrl: string;

export const openGraphLoader = async () => {
  const [fontSemiBold, fontRegular, fontCursive] = await Promise.all([
    fetch(new URL(`${appBaseUrl}/fonts/inter-semibold.ttf`)).then(async (res) => res.arrayBuffer()),
    fetch(new URL(`${appBaseUrl}/fonts/inter-regular.ttf`)).then(async (res) => res.arrayBuffer()),
    fetch(new URL(`${appBaseUrl}/fonts/caveat.ttf`)).then(async (res) => res.arrayBuffer()),
  ]);

  return { fontSemiBold, fontRegular, fontCursive };
};
