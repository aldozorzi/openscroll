import { customType } from 'drizzle-orm/pg-core';

export const vector1024 = customType<{
  data: number[];
  driverData: string;
}>({
  dataType() {
    return 'vector(1024)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: unknown): number[] {
    if (typeof value === 'string') {
      return JSON.parse(value) as number[];
    }
    return value as number[];
  },
});
