// Font config entries each have 'normal' style — distinct weights, structural repetition is intentional
declare function fetchFont(url: string): Promise<ArrayBuffer>;

async function getOpenGraphFonts() {
  const [regular, medium, semibold] = await Promise.all([
    fetchFont('https://fonts.example.com/sans-400.woff'),
    fetchFont('https://fonts.example.com/sans-500.woff'),
    fetchFont('https://fonts.example.com/sans-600.woff'),
  ]);

  return [
    { name: 'Inter', data: regular, weight: 400 as const, style: 'normal' as const },
    { name: 'Inter', data: medium, weight: 500 as const, style: 'normal' as const },
    { name: 'Inter', data: semibold, weight: 600 as const, style: 'normal' as const },
  ];
}
