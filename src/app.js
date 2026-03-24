const FBCFG={apiKey:"AIzaSyCUZKyN-sxLvJCXLAOUjZ_nsRghqUagcjs",authDomain:"yggdrasil-online.firebaseapp.com",databaseURL:"https://yggdrasil-online-default-rtdb.firebaseio.com",projectId:"yggdrasil-online",storageBucket:"yggdrasil-online.firebasestorage.app",messagingSenderId:"445950943508",appId:"1:445950943508:web:b2597f9ce1f12b8cd6a201"};
let fbAuth=null,fbDb=null,fbRt=null,fbOK=false;
try{const app=firebase.initializeApp(FBCFG);fbAuth=firebase.auth();fbDb=firebase.firestore();fbRt=firebase.database();fbOK=true;console.log('Firebase initialized');}catch(e){console.error('Firebase init failed',e);}
const Auth={
  google:async()=>{
    if(!fbOK){alert('Firebase not initialized');return;}
    const provider=new firebase.auth.GoogleAuthProvider();
    try{const result=await fbAuth.signInWithPopup(provider);console.log('Signed in',result.user);alert('Signed in as '+result.user.displayName);}catch(e){console.error(e);alert('Google sign in failed.');}
  },
  guest:()=>{
    const id='guest_'+Date.now();
    localStorage.setItem('guestId',id);
    alert('Guest mode active: '+id);
  }
};
