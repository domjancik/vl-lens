export function repositorySlug(value){
  value=value.trim();
  if(value.startsWith('https://')){
    const url=new URL(value);
    if(url.hostname!=='github.com'||url.username||url.password||url.port||url.search||url.hash)throw Error('Use a public github.com repository URL.');
    value=url.pathname.replace(/^\/|\/$/g,'');
  }
  value=value.replace(/\.git$/,'');
  if(!/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/i.test(value)||['.','..'].includes(value.split('/')[1]))throw Error('Enter owner/repository or a GitHub repository URL.');
  return value;
}
export function viewerURL(repo,ref=''){
  const query=new URLSearchParams({repo:repositorySlug(repo)});
  if(ref.trim())query.set('ref',ref.trim());
  return '/viewer?'+query;
}
export function apiURL(path,connection){
  if(!connection.repo||path==='/api/parse'||path==='/api/config')return path;
  const url=new URL(path,'http://localhost');
  url.searchParams.set('repo',connection.repo);
  const ref=url.pathname==='/api/documents'?connection.ref:connection.snapshot||connection.ref;
  if(ref&&!url.pathname.startsWith('/api/git/'))url.searchParams.set('ref',ref);
  return url.pathname+url.search;
}
