export interface MobileStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface MobileStorageBag {
  readonly metadata: MobileStorage;
  readonly secrets: MobileStorage;
}

export function createInMemoryMobileStorage(): MobileStorage {
  const store = new Map<string, string>();

  return {
    async getItem(key: string) {
      return store.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      store.set(key, value);
    },
    async removeItem(key: string) {
      store.delete(key);
    },
  };
}

export function createInMemoryMobileStorageBag(): MobileStorageBag {
  return {
    metadata: createInMemoryMobileStorage(),
    secrets: createInMemoryMobileStorage(),
  };
}

export async function createNativeMobileStorageBag(): Promise<MobileStorageBag> {
  const [{ default: AsyncStorage }, SecureStore] = await Promise.all([
    import("@react-native-async-storage/async-storage"),
    import("expo-secure-store"),
  ]);

  return {
    metadata: {
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => AsyncStorage.setItem(key, value),
      removeItem: (key) => AsyncStorage.removeItem(key),
    },
    secrets: {
      getItem: (key) => SecureStore.getItemAsync(key),
      setItem: (key, value) => SecureStore.setItemAsync(key, value),
      removeItem: (key) => SecureStore.deleteItemAsync(key),
    },
  };
}
