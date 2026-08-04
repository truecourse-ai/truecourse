// The app's own client import — the line the drafting prompt shows the model so a
// drafted script imports the client the same way this repository already does.
import { PrismaClient } from '@prisma/client'

export const db = new PrismaClient()
