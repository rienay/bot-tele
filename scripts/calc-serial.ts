const now = new Date('2026-09-22T00:00:00Z');
const epoch = new Date('1899-12-30T00:00:00Z');
const diffDays = Math.floor((now.getTime() - epoch.getTime()) / (86400 * 1000));
console.log('2026-09-22 serial is:', diffDays);
