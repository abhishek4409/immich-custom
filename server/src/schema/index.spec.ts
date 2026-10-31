import { schemaFromCode } from '@immich/sql-tools';
import { updated_at } from 'src/schema/functions.js';
import 'src/schema/index.js';

describe('schema', () => {
  it('should have an updateId column on every table using the updated_at trigger', () => {
    const { tables } = schemaFromCode({ overrides: true, namingStrategy: 'default' });

    const tablesWithTrigger = tables.filter((table) =>
      table.triggers.some((trigger) => trigger.functionName === updated_at.name),
    );
    const missing = tablesWithTrigger
      .filter((table) => table.columns.every((column) => column.name !== 'updateId'))
      .map((table) => table.name);

    expect(tablesWithTrigger.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
