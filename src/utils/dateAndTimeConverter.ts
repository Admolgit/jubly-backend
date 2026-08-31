export const dateConverter = (date: string | Date) => {
  return new Date(date).toLocaleDateString('en-NG', {
    timeZone: 'Africa/Lagos',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

export const timeConverter = (time: string | Date) => {
  return new Date(time).toLocaleTimeString('en-NG', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};
