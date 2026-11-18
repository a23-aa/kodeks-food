import { createRemoteJWKSet, jwtVerify } from 'jose'

const authorizationEndpoint='https://accounts.google.com/o/oauth2/v2/auth'
const tokenEndpoint='https://oauth2.googleapis.com/token'
const keys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
const text=new TextEncoder()
const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
const random=()=>base64url(crypto.getRandomValues(new Uint8Array(32)))

export const googleEnabled=env=>Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET)
export const callbackURL=origin=>new URL('/api/auth/google/callback',origin).href
export async function startGoogle(env,origin) {
  const flow={state:random(),nonce:random(),verifier:random()}
  const challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',text.encode(flow.verifier))))
  const url=new URL(authorizationEndpoint)
  url.search=new URLSearchParams({
    client_id:env.GOOGLE_CLIENT_ID,redirect_uri:callbackURL(origin),response_type:'code',scope:'openid email profile',
    state:flow.state,nonce:flow.nonce,code_challenge:challenge,code_challenge_method:'S256'
  })
  return {url:url.href,flow:[flow.state,flow.nonce,flow.verifier].join('.')}
}

export async function finishGoogle(env,request,origin) {
  const url=new URL(request.url)
  const cookie=/(?:^|;\s*)kodeks_google=([\w.-]{131})(?:;|$)/.exec(request.headers.get('Cookie')||'')?.[1]
  const [state,nonce,verifier]=cookie?.split('.')||[]
  const code=url.searchParams.get('code')
  if (!code||!state||state!==url.searchParams.get('state')) throw Error('Google OAuth state mismatch')
  const response=await fetch(tokenEndpoint,{method:'POST',body:new URLSearchParams({
    code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,
    redirect_uri:callbackURL(origin),grant_type:'authorization_code',code_verifier:verifier
  })})
  if (!response.ok) throw Error('Google token exchange failed')
  const {id_token}=await response.json()
  const {payload}=await jwtVerify(id_token,keys,{
    issuer:['https://accounts.google.com','accounts.google.com'],audience:env.GOOGLE_CLIENT_ID,requiredClaims:['exp','iat','sub']
  })
  if (payload.nonce!==nonce||payload.email_verified!==true||typeof payload.email!=='string') throw Error('Google identity verification failed')
  return {subject:payload.sub,email:payload.email.toLowerCase(),name:String(payload.name||payload.email.split('@')[0]).trim().slice(0,120)}
}
