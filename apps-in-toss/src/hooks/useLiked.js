import { useCallback, useState } from 'react';
import { toggleLikeApi } from '../api.js';

const STORAGE_KEY = 'likedBroadcasts';

function readLikedSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
  } catch (e) {
    return new Set();
  }
}

function writeLikedSet(set) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch (e) {}
}

// 찜 상태(localStorage)와 서버 카운트를 함께 관리하는 훅. 화면마다 각자 fetch하지 않고
// 하나의 소스로 공유해서, 홈에서 찜한 게 MY 탭에도 바로 반영되게 한다
export function useLiked() {
  const [likedIds, setLikedIds] = useState(() => readLikedSet());
  const [counts, setCounts] = useState({});

  const isLiked = useCallback((id) => likedIds.has(String(id)), [likedIds]);

  const setCount = useCallback((id, count) => {
    setCounts((prev) => ({ ...prev, [id]: count }));
  }, []);

  const toggle = useCallback(async (item) => {
    const id = String(item.id);
    const already = readLikedSet().has(id);
    const action = already ? 'unlike' : 'like';

    const result = await toggleLikeApi({
      id,
      action,
      title: item.title,
      url: item.url,
      platform: item.platform,
      start: item.start,
      end: item.end,
    });

    const next = readLikedSet();
    if (already) next.delete(id);
    else next.add(id);
    writeLikedSet(next);
    setLikedIds(new Set(next));

    if (result && typeof result.count === 'number') {
      setCount(id, result.count);
    }
  }, [setCount]);

  return { likedIds, isLiked, counts, setCount, toggle };
}
