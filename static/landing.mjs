import {viewerURL} from './remote.mjs';
document.getElementById('landingRepository').addEventListener('submit',event=>{
  event.preventDefault();
  let value=document.getElementById('repository').value.trim();
  if(value.startsWith('github.com/'))value='https://'+value;
  try{location.assign(viewerURL(value));}
  catch(error){document.getElementById('repositoryError').textContent=error.message;}
});
