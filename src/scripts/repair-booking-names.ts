import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type CliArgs = {
  apply: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  return { apply: argv.includes('--apply') };
}

type RawBooking = {
  _id: { $oid: string };
  serviceId: string;
  clientName?: string;
  name?: string;
};

type RawService = {
  _id: { $oid: string };
  name: string;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const findResult = (await prisma.$runCommandRaw({
    find: 'Booking',
    filter: {
      $or: [{ name: { $exists: false } }, { name: '' }],
    },
    projection: { _id: 1, serviceId: 1, clientName: 1, name: 1 },
  })) as unknown as { cursor: { firstBatch: RawBooking[] } };

  const bookings = findResult.cursor.firstBatch;

  if (!bookings.length) {
    console.log('No bookings require a name repair.');
    return;
  }

  const serviceIds = [...new Set(bookings.map((b) => b.serviceId))];

  const servicesResult = (await prisma.$runCommandRaw({
    find: 'Service',
    filter: { _id: { $in: serviceIds.map((id) => ({ $oid: id })) } },
    projection: { _id: 1, name: 1 },
  })) as unknown as { cursor: { firstBatch: RawService[] } };

  const serviceNameById = new Map(
    servicesResult.cursor.firstBatch.map((s) => [s._id.$oid, s.name]),
  );

  const repairs = bookings
    .map((booking) => {
      const serviceName = serviceNameById.get(booking.serviceId);

      if (!serviceName) {
        return null;
      }

      return {
        id: booking._id.$oid,
        clientName: booking.clientName || 'Unnamed client',
        currentName: booking.name ?? '(missing)',
        serviceName,
      };
    })
    .filter((repair): repair is NonNullable<typeof repair> => repair !== null);

  const unmatched = bookings.filter((b) => !serviceNameById.has(b.serviceId));

  if (unmatched.length) {
    console.warn(
      `Skipping ${unmatched.length} booking(s) with no matching service: ${unmatched
        .map((b) => b._id.$oid)
        .join(', ')}`,
    );
  }

  if (!repairs.length) {
    console.log('No bookings could be matched to a service.');
    return;
  }

  console.log(`Found ${repairs.length} booking(s) missing a name:`);
  for (const repair of repairs) {
    console.log(
      `  ${repair.id} (${repair.clientName}): "${repair.currentName}" -> "${repair.serviceName}"`,
    );
  }

  if (!args.apply) {
    console.log(
      'Dry run only. Re-run with "npm run repair:booking-names -- --apply" to persist changes.',
    );
    return;
  }

  for (const repair of repairs) {
    await prisma.$runCommandRaw({
      update: 'Booking',
      updates: [
        {
          q: { _id: { $oid: repair.id } },
          u: { $set: { name: repair.serviceName } },
        },
      ],
    });
  }

  console.log(`Updated ${repairs.length} booking(s).`);
}

main()
  .catch((error) => {
    console.error('Failed to repair booking names:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
