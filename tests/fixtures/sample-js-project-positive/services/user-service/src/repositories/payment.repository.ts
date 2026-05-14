import { PrismaClient } from "@prisma/client";
import { chargeCard } from "../external/payment-gateway";

export class PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async chargeUser(userId: string, amount: number): Promise<unknown> {
    await this.prisma.payment.create({ data: { userId, amount } });
    return chargeCard(amount);
  }
}
