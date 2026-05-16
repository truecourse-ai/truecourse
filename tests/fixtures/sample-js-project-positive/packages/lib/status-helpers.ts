
enum ParticipantStatusType {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  DECLINED = 'DECLINED',
  COMPLETED = 'COMPLETED',
}

type ParticipantForStatus = {
  status: string;
  isViewer: boolean;
};

function getParticipantStatus(participant: ParticipantForStatus): ParticipantStatusType {
  if (participant.isViewer) {
    return ParticipantStatusType.COMPLETED;
  }
  if (participant.status === 'active') {
    return ParticipantStatusType.ACTIVE;
  }
  return ParticipantStatusType.PENDING;
}

function getGroupParticipantStatus(participants: ParticipantForStatus[]): ParticipantStatusType {
  const types = participants.map((p) => getParticipantStatus(p));

  if (types.includes(ParticipantStatusType.DECLINED)) {
    return ParticipantStatusType.DECLINED;
  }

  if (types.includes(ParticipantStatusType.ACTIVE)) {
    return ParticipantStatusType.ACTIVE;
  }

  if (types.includes(ParticipantStatusType.PENDING)) {
    return ParticipantStatusType.PENDING;
  }

  return ParticipantStatusType.COMPLETED;
}
