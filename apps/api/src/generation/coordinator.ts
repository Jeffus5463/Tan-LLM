export interface ActiveGeneration {
  chatId: string;
  messageId: string;
}

export interface GenerationLease {
  generation: ActiveGeneration;
  release: () => void;
}

interface StoredGeneration extends ActiveGeneration {
  leaseId: symbol;
}

export class GenerationCoordinator {
  private activeGeneration: StoredGeneration | null = null;

  tryAcquire(generation: ActiveGeneration): GenerationLease | null {
    if (this.activeGeneration) {
      return null;
    }

    const leaseId = Symbol("generation-lease");

    this.activeGeneration = {
      ...generation,
      leaseId,
    };

    return {
      generation: {
        ...generation,
      },
      release: () => {
        if (this.activeGeneration?.leaseId === leaseId) {
          this.activeGeneration = null;
        }
      },
    };
  }

  getActiveGeneration(): ActiveGeneration | null {
    if (!this.activeGeneration) {
      return null;
    }

    return {
      chatId: this.activeGeneration.chatId,
      messageId: this.activeGeneration.messageId,
    };
  }

  isChatActive(chatId: string): boolean {
    return this.activeGeneration?.chatId === chatId;
  }
}
