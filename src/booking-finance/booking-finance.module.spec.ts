import { Test } from '@nestjs/testing';
import { PrismaService } from 'prisma/prisma.service';
import { BookingFinanceModule } from './booking-finance.module';
import { BookingFinanceService } from './booking-finance.service';

it('wires the coordinator and existing policy services without a circular dependency', async () => {
  const module = await Test.createTestingModule({
    imports: [BookingFinanceModule],
  })
    .overrideProvider(PrismaService)
    .useValue({})
    .compile();
  expect(module.get(BookingFinanceService)).toBeInstanceOf(
    BookingFinanceService,
  );
  await module.close();
});
