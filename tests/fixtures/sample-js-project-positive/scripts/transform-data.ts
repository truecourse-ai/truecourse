
declare function formatDateLabel(date: string, metric: string): string;

function transformChartData(dates: string[], metric: string): string[] {
  return dates.map((date) => {
    try {
      return formatDateLabel(date, metric);
    } catch (error) {
      console.error('Error formatting date:', error, date);
      return date;
    }
  });
}
