"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    const b = await prisma.$runCommandRaw({
        find: 'Booking',
        filter: {},
        limit: 3,
    });
    console.log(JSON.stringify(b, null, 2));
    const s = await prisma.$runCommandRaw({
        find: 'Service',
        filter: {},
        limit: 3,
    });
    console.log(JSON.stringify(s, null, 2));
}
main().finally(() => prisma.$disconnect());
