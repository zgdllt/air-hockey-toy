const SDK_URL = 'https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js';

export function createToyPlatform(host = window) {
  let loading;
  const support = new Map();
  const inToy = () => ['www.bilibili.com', 'www.bilibilitoy.com'].includes(host.location?.hostname)
    && host.location.pathname.startsWith('/toy/');
  async function ready() {
    if (host.toy) return host.toy;
    if (!inToy()) return null;
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const script = host.document.createElement('script');
        script.src = SDK_URL; script.async = true;
        script.onload = () => host.toy ? resolve(host.toy) : reject(new Error('Toy SDK 未能初始化，请稍后再试。'));
        script.onerror = () => { script.remove(); reject(new Error('Toy 服务暂时连接不上，请稍后再试。')); };
        host.document.head.append(script);
      }).catch(error => { loading = null; throw error; });
    }
    return loading;
  }
  async function call(ability, ...args) {
    const sdk = await ready();
    if (!sdk) throw new Error('请在 B站 Toy 中打开游戏，使用连击排行榜。');
    if (!support.has(ability)) support.set(ability, sdk.isSupport(ability).catch(error => { support.delete(ability); throw error; }));
    if (!await support.get(ability)) throw new Error('当前环境暂不支持这项 Toy 功能。');
    try { return await sdk[ability](...args); }
    catch (error) {
      if (String(error?.message).includes('toy id not available')) {
        throw new Error('预览暂未绑定正式排行榜，请在上线后的 Toy 页面查看。');
      }
      throw error;
    }
  }
  return { ready, call, isToy: () => inToy() || Boolean(host.toy) };
}
