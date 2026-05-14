import { PrismaClient } from "@prisma/client";
import { chargeCard } from "../external/payment-client";

const prisma = new PrismaClient();
export class PaymentRepository {
  async charge(userId: string, amount: number): Promise<unknown> {
    await prisma.payment.create({ data: { userId, amount } });
    return chargeCard(amount);
  }
}
