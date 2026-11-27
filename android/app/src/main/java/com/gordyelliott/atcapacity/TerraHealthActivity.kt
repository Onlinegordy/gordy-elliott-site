package com.gordyelliott.atcapacity
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import co.tryterra.terra.Terra
import co.tryterra.terra.enums.Connections
import co.tryterra.terra.enums.CustomPermissions

// Terra registers permission contracts during instance(): initialise before onResume.
class TerraHealthActivity: AppCompatActivity() {
 override fun onCreate(state:Bundle?) {
  super.onCreate(state)
  val devId=intent.getStringExtra("devId"); val reference=intent.getStringExtra("referenceId");val token=intent.getStringExtra("token")
  if(devId==null||reference==null||token==null){finish();return}
  Terra.instance(devId,reference,this) {manager,error ->
   if(error!=null){runOnUiThread{finish()};return@instance}
   runOnUiThread {
    manager.initConnection(connection=Connections.HEALTH_CONNECT, token=token, context=this,
     customPermissions=setOf(
      CustomPermissions.WORKOUT_TYPE,
      CustomPermissions.STEPS,
      CustomPermissions.RESTING_HEART_RATE,
      CustomPermissions.HEART_RATE_VARIABILITY,
      CustomPermissions.SLEEP_ANALYSIS,
      CustomPermissions.CALORIES
     ),schedulerOn=true,startIntent=null) {success,connectionError ->
      val id=manager.getUserId(Connections.HEALTH_CONNECT)
      runOnUiThread {if(success&&connectionError==null&&id!=null)setResult(Activity.RESULT_OK,Intent().putExtra("userId",id));finish()}
    }
   }
  }
 }
}
