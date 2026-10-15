// Read-only audit by default. Pass --apply to create only the booking claim index.
require('dotenv').config({
  path: require('path').join(__dirname, '../.env'),
  quiet: true,
});
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const audit = await prisma.settlement.aggregateRaw({
    pipeline: [
      {
        $facet: {
          total: [{ $count: 'count' }],
          duplicateBookingIds: [
            { $group: { _id: '$bookingId', count: { $sum: 1 } } },
            { $match: { count: { $gt: 1 } } },
            { $count: 'groups' },
          ],
          invalidBookingIds: [
            {
              $match: { $expr: { $ne: [{ $type: '$bookingId' }, 'objectId'] } },
            },
            { $count: 'count' },
          ],
          duplicateReferences: [
            { $match: { reference: { $type: 'string' } } },
            { $group: { _id: '$reference', count: { $sum: 1 } } },
            { $match: { count: { $gt: 1 } } },
            { $count: 'groups' },
          ],
          referenceTypes: [
            { $group: { _id: { $type: '$reference' }, count: { $sum: 1 } } },
          ],
        },
      },
    ],
  });
  console.log(JSON.stringify(audit, null, 2));

  if (!process.argv.includes('--apply')) return;
  if (
    audit[0].duplicateBookingIds.length ||
    audit[0].invalidBookingIds.length
  ) {
    throw new Error(
      'Resolve duplicate or invalid booking IDs before creating the index',
    );
  }

  // MongoDB rechecks uniqueness during index creation, including concurrent writes.
  await prisma.$runCommandRaw({
    createIndexes: 'Settlement',
    indexes: [
      { key: { bookingId: 1 }, name: 'Settlement_bookingId_key', unique: true },
    ],
  });
  console.log(
    'Verified unique Settlement.bookingId index. No settlement records changed.',
  );
}

main()
  .catch((error) => {
    console.error(
      'Settlement index audit/apply failed:',
      error.code || error.name,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
