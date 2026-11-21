import { useState } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { AudioSpectrum, PulseBadge, ThreeOrb } from '../components/LiveVisuals'
import type { SessionState } from '../src/types/session'
import { colors } from '../src/theme/colors'

const sample = [
  { role: 'You', text: 'What does this voice assistant connect?' },
  { role: 'Sample assistant', text: 'The client separates realtime audio, session access, and explicit tool calls. This authored conversation is an offline example.' },
  { role: 'You', text: 'Show the interface without using a microphone or a paid provider.' },
]

/** Public, read-only fixture route; it never starts a live session or tool call. */
export default function Demo() {
  const [state, setState] = useState<SessionState>('idle')
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <Text style={styles.eyebrow}>M8 Live · Offline interface walkthrough</Text>
    <Text style={styles.title}>Voice and tools, with clear session states.</Text>
    <Text style={styles.copy}>Explore the application’s shared visual components with an authored sample conversation. No microphone access, live model session, or external tool is started.</Text>
    <View style={styles.workspace}>
      <View style={styles.visual}>
        {Platform.OS === 'web' ? <ThreeOrb state={state} micLevel={0} /> : null}
        <PulseBadge label={state === 'idle' ? 'Ready to preview' : `Preview: ${state}`} color={colors.emerald} />
        <View style={styles.choices}>{(['idle', 'listening', 'responding'] as SessionState[]).map(option => <Pressable key={option} accessibilityRole="button" accessibilityLabel={`Preview ${option} state`} onPress={() => setState(option)} style={[styles.choice, state === option && styles.selected]}><Text style={styles.choiceText}>{option}</Text></Pressable>)}</View>
      </View>
      <View style={styles.conversation}>
        <Text style={styles.section}>Sample conversation</Text>
        {sample.map((item,index) => <View key={index} style={styles.turn}><Text style={styles.role}>{item.role}</Text><Text style={styles.message}>{item.text}</Text></View>)}
        <Text style={styles.note}>The production client requires its configured bridge, authentication, and Gemini access for a live conversation. This route previews the interface only.</Text>
      </View>
    </View>
  </ScrollView>
}

const styles = StyleSheet.create({
  page:{flex:1,backgroundColor:colors.bg}, content:{padding:32,paddingTop:46,maxWidth:1180,width:'100%',alignSelf:'center'},
  eyebrow:{color:colors.emerald,fontSize:15,fontWeight:'600',marginBottom:18},title:{color:colors.text,fontSize:40,fontWeight:'600',lineHeight:46,maxWidth:800},
  copy:{color:'#a8b2bc',fontSize:17,lineHeight:26,maxWidth:880,marginTop:18,marginBottom:34},workspace:{flexDirection:'row',flexWrap:'wrap',gap:24},
  visual:{flex:1,minWidth:320,minHeight:420,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.border,borderRadius:12,padding:18},
  conversation:{flex:1,minWidth:320,borderWidth:1,borderColor:colors.border,borderRadius:12,padding:24},section:{color:colors.text,fontSize:21,fontWeight:'600',marginBottom:24},
  turn:{paddingVertical:16,borderBottomWidth:1,borderBottomColor:colors.border},role:{color:colors.emerald,fontSize:13,fontWeight:'600',marginBottom:7},message:{color:colors.text,fontSize:16,lineHeight:25},
  note:{color:'#9ca8b5',fontSize:13,lineHeight:21,marginTop:24},choices:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:24},
  choice:{paddingHorizontal:14,paddingVertical:10,borderRadius:8,borderWidth:1,borderColor:colors.border},selected:{backgroundColor:'#12362d',borderColor:colors.emerald},choiceText:{color:colors.text,fontSize:14},
})
