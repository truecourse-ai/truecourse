
declare function useState<T>(initial: T): [T, React.Dispatch<React.SetStateAction<T>>];

type DownloadVersion = 'original' | 'signed' | 'pending';

function generateDownloadKey(itemId: string, version: DownloadVersion): string {
  return `${itemId}:${version}`;
}

const [isDownloadingState, setIsDownloadingState] = useState<Record<string, boolean>>({});

async function handleDownload(itemId: string, version: DownloadVersion) {
  const key = generateDownloadKey(itemId, version);

  if (isDownloadingState[key]) {
    return;
  }

  setIsDownloadingState((prev) => ({
    ...prev,
    [key]: true,
  }));

  try {
    await Promise.resolve(); // simulate async download

    setIsDownloadingState((prev) => ({
      ...prev,
      [key]: false,
    }));
  } catch (error) {
    setIsDownloadingState((prev) => ({
      ...prev,
      [key]: false,
    }));
  }
}
