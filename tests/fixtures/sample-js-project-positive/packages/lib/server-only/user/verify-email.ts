import { prisma } from '@app/prisma';
import { DateTime } from 'luxon';

import { EMAIL_VERIFICATION_STATE, USER_SIGNUP_VERIFICATION_TOKEN_IDENTIFIER } from '../../constants/email';
import { jobsClient } from '../../jobs/client';

export type VerifyEmailProps = {
  token: string;
};

export const verifyEmail = async ({ token }: VerifyEmailProps) => {
  const verificationToken = await prisma.verificationToken.findFirst({
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
    where: {
      token,
      identifier: USER_SIGNUP_VERIFICATION_TOKEN_IDENTIFIER,
    },
  });

  if (!verificationToken) {
    return {
      state: EMAIL_VERIFICATION_STATE.NOT_FOUND,
      userId: null,
    };
  }

  // check if the token is valid or expired
  const valid = verificationToken.expires > new Date();

  if (!valid) {
    const mostRecentToken = await prisma.verificationToken.findFirst({
      where: {
        userId: verificationToken.userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // If there isn't a recent token or it's older than 1 hour, send a new token
    if (!mostRecentToken || DateTime.now().minus({ hours: 1 }).toJSDate() > mostRecentToken.createdAt) {
      await jobsClient.triggerJob({
        name: 'send.signup.confirmation.email',
        payload: {
          email: verificationToken.user.email,
        },
      });
    }

    return {
      state: EMAIL_VERIFICATION_STATE.EXPIRED,
      userId: null,
    };
  }

  if (verificationToken.completed) {
    return {
      state: EMAIL_VERIFICATION_STATE.ALREADY_VERIFIED,
      userId: null,
    };
  }

  const [updatedUser] = await prisma.$transaction([
    prisma.user.update({
      where: {
        id: verificationToken.userId,
      },
      data: {
        emailVerified: new Date(),
      },
    }),
    prisma.verificationToken.updateMany({
      where: {
        userId: verificationToken.userId,
      },
      data: {
        completed: true,
      },
    }),
    // Tidy up old expired tokens
    prisma.verificationToken.deleteMany({
      where: {
        userId: verificationToken.userId,
        expires: {
          lt: new Date(),
        },
      },
    }),
  ]);

  if (!updatedUser) {
    throw new Error('Something went wrong while verifying your email. Please try again.');
  }

  return {
    state: EMAIL_VERIFICATION_STATE.VERIFIED,
    userId: updatedUser.id,
  };
};


// FP 3a8e99ea31bf: verificationToken.findFirst in verify-email.ts
// findFirst with orderBy: { createdAt: desc } selects the most recent from a multi-row set.
// This is a "find most recent" pattern — NOT a uniqueness check before insert.
// The missing-unique-constraint rule should not fire on orderBy findFirst lookups.
declare const prismaVerify_3a8e: {
  verificationToken: {
    findFirst: (args: {
      where: { userId: string };
      orderBy: { createdAt: string };
    }) => Promise<{ id: string; token: string; createdAt: Date } | null>;
  };
};
export async function findMostRecentVerificationToken_3a8e(
  userId: string
): Promise<{ id: string; token: string } | null> {
  return prismaVerify_3a8e.verificationToken.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

