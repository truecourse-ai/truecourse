
declare const db: {
  registeredDevice: {
    findFirst: (args: any) => Promise<{ id: string; userId: number; credentialId: string; label: string } | null>;
    delete: (args: any) => Promise<any>;
  };
};

// Looks up a specific registered device by both userId (FK) and id (PK).
// id carries an implicit PK unique constraint — findFirst is used here instead
// of findUnique because we also filter by userId as an ownership check.
export async function getDeviceForUser(userId: number, deviceId: string): Promise<{ id: string; label: string } | null> {
  const device = await db.registeredDevice.findFirst({
    where: { userId, id: deviceId },
  });

  return device ? { id: device.id, label: device.label } : null;
}

export async function deleteDeviceForUser(userId: number, deviceId: string): Promise<void> {
  const device = await db.registeredDevice.findFirst({
    where: { userId, id: deviceId },
  });

  if (!device) {
    throw new Error('Device not found');
  }

  await db.registeredDevice.delete({ where: { id: device.id } });
}
