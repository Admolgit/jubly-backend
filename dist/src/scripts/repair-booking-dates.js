"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const BOOKING_TIMEZONE = 'Africa/Lagos';
function parseArgs(argv) {
    const args = {
        apply: false,
    };
    for (const arg of argv) {
        if (arg === '--apply') {
            args.apply = true;
            continue;
        }
        if (arg.startsWith('--limit=')) {
            const rawValue = Number.parseInt(arg.split('=')[1] ?? '', 10);
            if (Number.isNaN(rawValue) || rawValue <= 0) {
                throw new Error('--limit must be a positive integer');
            }
            args.limit = rawValue;
        }
    }
    return args;
}
function getDatePartsInBookingTimezone(value) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: BOOKING_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(value);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (!year || !month || !day) {
        throw new Error('Failed to resolve booking date parts');
    }
    return { year, month, day };
}
function toBookingDateFromStartTime(startTime) {
    const { year, month, day } = getDatePartsInBookingTimezone(startTime);
    return new Date(`${year}-${month}-${day}T00:00:00.000+01:00`);
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const bookings = await prisma.booking.findMany({
        take: args.limit,
        orderBy: {
            createdAt: 'asc',
        },
        select: {
            id: true,
            clientName: true,
            clientEmail: true,
            createdAt: true,
            date: true,
            startTime: true,
        },
    });
    const repairs = bookings
        .map((booking) => {
        const expectedDate = toBookingDateFromStartTime(booking.startTime);
        const currentDate = new Date(booking.date);
        if (currentDate.getTime() === expectedDate.getTime()) {
            return null;
        }
        return {
            id: booking.id,
            clientName: booking.clientName || 'Unnamed client',
            clientEmail: booking.clientEmail,
            createdAt: booking.createdAt.toISOString(),
            currentDate: currentDate.toISOString(),
            expectedDate: expectedDate.toISOString(),
        };
    })
        .filter((repair) => repair !== null);
    if (!repairs.length) {
        console.log('No bookings require date repair.');
        return;
    }
    if (!args.apply) {
        console.log('Dry run only. Re-run with "npm run repair:booking-dates -- --apply" to persist changes.');
        return;
    }
    for (const repair of repairs) {
        await prisma.booking.update({
            where: { id: repair.id },
            data: { date: new Date(repair.expectedDate) },
        });
    }
}
main()
    .catch((error) => {
    console.error('Failed to repair booking dates:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await prisma.$disconnect();
});
