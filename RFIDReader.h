#ifndef RFID_READER_H
#define RFID_READER_H
#define EPC_QUEUE_SIZE 64
#define RFID_FRAME_BUFFER_SIZE 128

#include <HardwareSerial.h>
#include <utility>
#include "config.h"

HardwareSerial* rfidSerial = nullptr;
byte tempBuffer[RFID_FRAME_BUFFER_SIZE];
unsigned int tempBufferLen = 0;
unsigned int expectedFrameLength = 0;
String EPCQueue[EPC_QUEUE_SIZE];
unsigned int EPCQueueWriteIndex = 0;
unsigned int EPCQueueReadIndex = 0;
unsigned int EPCQueueCount = 0;

bool EPCEnqueue(String &&epc){
  if(EPCQueueCount >= EPC_QUEUE_SIZE){
    return false;
  }

  EPCQueue[EPCQueueWriteIndex] = std::move(epc);
  EPCQueueWriteIndex = (EPCQueueWriteIndex + 1) % EPC_QUEUE_SIZE;
  EPCQueueCount++;
  return true;
}

String EPCDequeue(){
  if(EPCQueueCount == 0){
    return "";
  }
  String epc = std::move(EPCQueue[EPCQueueReadIndex]);
  EPCQueueReadIndex = (EPCQueueReadIndex + 1) % EPC_QUEUE_SIZE;
  EPCQueueCount--;
  return epc;
}

String EPCPeak(){
  if(EPCQueueCount == 0){
    return "";
  }
  int index = EPCQueueReadIndex - 1;
  if(index < 0){
    index = EPC_QUEUE_SIZE - 1;
  }
  return EPCQueue[index];
}



class RFIDReader {
private:
  
  byte inventoryCmd[7] = CMD_SINGLE_INVENTORY;
  byte inventoryCMD_Multi[10] = CMD_MULTIPLE_INVENTORY;
  byte stopCmd[7] = CMD_STOP_INVENTORY;
  bool isReading;
  
  // 主动轮询相关变量
  unsigned long lastPollTime;
  unsigned long lastResponseTime;
  int consecutiveErrors;
  bool waitingForResponse;

  void drainSerialInput(unsigned long maxDurationMs = 20) {
    unsigned long startTime = millis();
    while (rfidSerial->available() && (millis() - startTime) < maxDurationMs) {
      rfidSerial->read();
    }
  }

  void processFrame() {
    if (tempBufferLen == 0 || tempBuffer[0] != 0xBB) {
      #if RFID_DEBUG_ENABLED
      Serial.println("[RFID] processFrame: 无效帧头");
      #endif
      return;
    }
    
    // 检查是否为盘点响应帧 (命令码 0x22)
    if (tempBuffer[1] == 0x02 && tempBuffer[2] == 0x22) {
      int dataLen = (tempBuffer[3] << 8) | tempBuffer[4];
      int epcLen = dataLen - 5;  // RSSI(1) + PC(2)
      
      if (epcLen > 4) {
        // 提取 EPC 并转为十六进制字符串
        String shortEpc = "";
        for (int i = 8; i < 8 + 4; i++) {
          if (tempBuffer[i] < 0x10) shortEpc += "0";
          shortEpc += String(tempBuffer[i], HEX);
        }
        shortEpc.toUpperCase();
        
        //String shortEpc = fullEpc.substring(0, min(8, (int)fullEpc.length()));
        #if RFID_DEBUG_ENABLED
        //Serial.print("[RFID] ✅ 标签 - 使用EPC: ");
        // Serial.print(fullEpc);
        // Serial.print(", 入队EPC: ");
        //Serial.println(shortEpc);
        #endif
        if(shortEpc != EPCPeak()){
          if (!EPCEnqueue(std::move(shortEpc))) {
            #if RFID_DEBUG_ENABLED
            Serial.println("[RFID] ⚠️ 队列已满，丢弃标签");
            #endif
          }
        }
        else{
          Serial.println("已有该数据，取消加入队列："+shortEpc);
        }
        
      } else {
        #if RFID_DEBUG_ENABLED
        Serial.println("[RFID] ⚠️ EPC长度为0或帧数据不足");
        #endif
      }
    } else {
      #if RFID_DEBUG_ENABLED
      // Serial.print("[RFID] 忽略非盘点帧: 0x");
      // Serial.print(tempBuffer[1], HEX);
      // Serial.print(" 0x");
      // Serial.println(tempBuffer[2], HEX);
      #endif
    }
  }

  bool appendRfidFrameByte(byte b) {
    // 基于协议长度字段组帧，避免参数区或校验位中出现 0x7E 时被误判为帧尾。
    if (tempBufferLen == 0) {
      if (b != 0xBB) {
        return false;
      }
      tempBuffer[tempBufferLen++] = b;
      expectedFrameLength = 0;
      return false;
    }

    if (tempBufferLen >= sizeof(tempBuffer)) {
      #if RFID_DEBUG_ENABLED
      //Serial.println("[RFID] 帧缓冲区溢出，重置");
      #endif
      tempBufferLen = 0;
      expectedFrameLength = 0;
      if (b == 0xBB) {
        tempBuffer[tempBufferLen++] = b;
      }
      return false;
    }

    tempBuffer[tempBufferLen++] = b;

    if (tempBufferLen == 5) {
      unsigned int parameterLength = ((unsigned int)tempBuffer[3] << 8) | tempBuffer[4];
      expectedFrameLength = parameterLength + 7;

      if (expectedFrameLength > sizeof(tempBuffer) || expectedFrameLength < 7) {
        #if RFID_DEBUG_ENABLED
        //Serial.println("[RFID] 帧长度异常，丢弃当前帧");
        #endif
        tempBufferLen = 0;
        expectedFrameLength = 0;
        return false;
      }
    }

    if (expectedFrameLength > 0) {
      if (tempBufferLen == expectedFrameLength) {
        if (tempBuffer[expectedFrameLength - 1] == 0x7E) {
          processFrame();
          tempBufferLen = 0;
          expectedFrameLength = 0;
          return true;
        }

        #if RFID_DEBUG_ENABLED
        //Serial.println("[RFID] 帧尾错误，丢弃当前帧");
        #endif
        tempBufferLen = 0;
        expectedFrameLength = 0;
        return false;
      }
    }

    return false;
  }

  unsigned int readAvailableRfidFrames(unsigned int maxBytesPerCall, unsigned long* lastByteTime = nullptr) {
    unsigned int bytesReadThisCall = 0;

    while (rfidSerial->available() > 0 && bytesReadThisCall < maxBytesPerCall) {
      byte b = rfidSerial->read();
      bytesReadThisCall++;
      if (lastByteTime != nullptr) {
        *lastByteTime = millis();
      }
      appendRfidFrameByte(b);
      yield();
    }

    return bytesReadThisCall;
  }
  
  
public:
  RFIDReader() : isReading(false), 
                 lastPollTime(0), lastResponseTime(0), 
                 consecutiveErrors(0), waitingForResponse(false) {}
  
  void begin() {
    rfidSerial = new HardwareSerial(RFID_SERIAL_RX, RFID_SERIAL_TX);
    rfidSerial->begin(RFID_BAUDRATE);
    delay(1000);
    Serial.println("RFID Reader initialized");
    Serial.println("Testing RFID connection...");
    
    
    // 测试连接
    if (checkConnection()) {
      Serial.println("✅ RFID阅读器连接正常");
    } else {
      Serial.println("❌ RFID阅读器连接失败，请检查接线");
    }

    // STM32 Arduino Core 不支持 ESP32 风格的 HardwareSerial::onReceive()。
    // 多次轮询模式下，串口数据由底层中断进入缓冲区，主 loop 调用
    // receiveTagMultiInventory() 读取缓冲区即可。
  }
  
  void startInventory() {
    if (!isReading) {
      #if RFID_DEBUG_ENABLED
      Serial.println("[RFID] 发送单次轮询指令: BB 00 22 00 00 22 7E");
      #endif
      rfidSerial->write(inventoryCmd, sizeof(inventoryCmd));
      isReading = true;
      lastPollTime = millis();
      lastResponseTime = millis();
      waitingForResponse = true;
      consecutiveErrors = 0;
      Serial.println("[RFID] ✅ 开始扫描模式 - 主动轮询已激活");
    }
  }
  void startMultiInventory() {
    if (!isReading) {
      #if RFID_DEBUG_ENABLED
      Serial.println("[RFID] 发送多次轮询指令: BB 00 27 00 03 22 FF FF 4A 7E");
      #endif
      rfidSerial->write(inventoryCMD_Multi, sizeof(inventoryCMD_Multi));
      isReading = true;
      lastPollTime = millis();
      lastResponseTime = millis();
      waitingForResponse = true;
      consecutiveErrors = 0;
      Serial.println("[RFID] ✅ 开始扫描模式 - 多次轮询已激活");
    }
  }
  
  void stopInventory() {
    if (isReading) {
      #if RFID_DEBUG_ENABLED
      Serial.println("[RFID] 发送停止轮询指令: BB 00 28 00 00 28 7E");
      #endif
      rfidSerial->write(stopCmd, sizeof(stopCmd));
      isReading = false;
      waitingForResponse = false;
      consecutiveErrors = 0;
      Serial.println("[RFID] 🛑 停止扫描");
    }
  }
  
  String readTag() {
    unsigned long now = millis();
    
    // // ========== 优化：优先检查超时，确保及时重置状态 ==========
    // // 在等待响应时，立即检查是否超时，避免状态卡死
    // unsigned long responseWaitTime = now - lastResponseTime;
    // if (responseWaitTime >= RFID_RESPONSE_TIMEOUT) {
    //   #if RFID_DEBUG_ENABLED
    //   Serial.print("[RFID] ⚠️ 响应超时 (");
    //   Serial.print(responseWaitTime);
    //   Serial.println("ms)，重置状态并重新发送轮询指令");
    //   #endif
    //   consecutiveErrors++;
      
    //   // 清空缓冲区，避免数据堆积
    //   while (rfidSerial->available()) {
    //     rfidSerial->read();
    //   }
      
    //   // 立即重置等待状态，避免状态卡死
    //   waitingForResponse = false;
      
    //   // 如果连续错误过多，尝试恢复
    //   if (consecutiveErrors >= RFID_MAX_RETRY) {
    //     #if RFID_DEBUG_ENABLED
    //     Serial.println("[RFID] ⚠️ 连续错误过多，执行错误恢复");
    //     #endif
    //     performErrorRecovery();
    //     consecutiveErrors = 0;
    //   }
    // }
    
    // // ========== 步骤1: 主动轮询机制 ==========
    // // 无论是否有数据，都定期发送轮询指令
    // if (isReading) {
    //   // 检查是否需要发送新的轮询指令
    //   bool needNewPoll = false;
      
    //   if (!waitingForResponse) {
    //     // 不在等待响应状态，可以发送新指令
    //     if (now - lastPollTime >= RFID_POLL_INTERVAL) {
    //       needNewPoll = true;
    //     }
    //   }
    //   // 注意：如果waitingForResponse为true，但已在上面的超时检查中重置，这里会继续处理
      
    //   // 发送新的轮询指令
    //   if (needNewPoll) {
    //     #if RFID_DEBUG_ENABLED
    //     Serial.print("[RFID] 📡 主动发送轮询指令 (间隔: ");
    //     Serial.print(now - lastPollTime);
    //     Serial.println("ms)");
    //     #endif
    //     rfidSerial->write(inventoryCmd, sizeof(inventoryCmd));
    //     rfidSerial->flush();  // 确保数据发送完成
    //     lastPollTime = now;
    //     lastResponseTime = now;
    //     waitingForResponse = true;
    //   }
    // }
    
    // ========== 步骤2: 处理接收到的数据 ==========
    if (rfidSerial->available()) {
      //waitingForResponse = false;  // 收到响应，不再等待
      lastResponseTime = now;
      consecutiveErrors = 0;  // 重置错误计数
      
      #if RFID_DEBUG_ENABLED
      Serial.println("[RFID] 📥 串口有数据，开始读取...");
      #endif
      
      // 优化：快速读取帧头，减少阻塞时间
      byte buffer[64];
      int len = 0;
      
      // 等待帧头（进一步减少等待时间，避免长时间阻塞）
      unsigned long startWait = millis();
      while (rfidSerial->available() < 1 && (millis() - startWait) < 20) {  // 从50ms减少到20ms
        yield();  // 使用yield()而不是delay(1)，让出CPU时间
      }
      
      if (rfidSerial->available() > 0) {
        buffer[0] = rfidSerial->read();
        if (buffer[0] == 0xBB) {
          len = 1;
          // 读取剩余数据直到帧尾（减少超时时间，提高响应速度）
          unsigned long frameStartTime = millis();
          while (len < 64 && (millis() - frameStartTime) < 50) {  // 从100ms减少到50ms
            if (rfidSerial->available() > 0) {
              buffer[len] = rfidSerial->read();
              len++;
              // 检查是否到达帧尾
              if (buffer[len - 1] == 0x7E) {
                break;
              }
            } else {
              yield();  // 使用yield()而不是delay(1)
            }
          }
        } else {
          // 帧头错误，清空缓冲区
          drainSerialInput();
          //XH：输出帧头错误信息，测试数据情况。
          Serial.print("帧头错误！");
          consecutiveErrors++;
          // 确保状态已重置
          waitingForResponse = false;
          return "";
        }
      } else {
        // 没有数据，确保状态已重置
        waitingForResponse = false;
        return "";
      }
      
      #if RFID_DEBUG_ENABLED
      Serial.print("[RFID] 收到数据长度: ");
      Serial.println(len);
      
      // 打印原始数据用于调试
      Serial.print("[RFID] 原始数据: ");
      for (int i = 0; i < len && i < 20; i++) {  // 只打印前20字节
        if (buffer[i] < 0x10) Serial.print("0");
        Serial.print(buffer[i], HEX);
        Serial.print(" ");
      }
      if (len > 20) Serial.print("...");
      Serial.println();
      #endif
      
      if (len > 0 && buffer[0] == 0xBB) {
        #if RFID_DEBUG_ENABLED
        Serial.println("[RFID] ✅ 帧头正确 (0xBB)");
        #endif
        
        if (buffer[1] == 0x02 && buffer[2] == 0x22) {
          #if RFID_DEBUG_ENABLED
          Serial.println("[RFID] ✅ 通知帧类型正确 (0x02 0x22)");
          #endif
          
          int dataLen = buffer[4] * 256 + buffer[5];
          int epcLen = dataLen - 3; // 减去RSSI(1) + PC(2)
          
          #if RFID_DEBUG_ENABLED
          Serial.print("[RFID] 数据长度: ");
          Serial.print(dataLen);
          Serial.print(", EPC长度: ");
          Serial.println(epcLen);
          #endif
          
          if (epcLen > 0) {
            String fullEPC = "";
            for (int i = 8; i < 8 + epcLen && i < len; i++) {
              if (buffer[i] < 0x10) fullEPC += "0";
              fullEPC += String(buffer[i], HEX);
            }
            fullEPC.toUpperCase();
            
            // 只返回前8位作为短EPC
            String shortEPC = fullEPC;
            if (fullEPC.length() >= 8) {
              shortEPC = fullEPC.substring(0, 8);
            }
            
            Serial.print("[RFID] ✅ 检测到标签 - 完整EPC: ");
            Serial.print(fullEPC);
            Serial.print(", 使用EPC: ");
            Serial.println(shortEPC);
            
            // 检测到标签后，立即准备下次轮询（不延迟）
            // 注意：不在这里发送新指令，让主动轮询机制处理
            waitingForResponse = false;
            
            return shortEPC;
          } else {
            #if RFID_DEBUG_ENABLED
            Serial.println("[RFID] ⚠️ EPC长度为0（无标签响应）");
            #endif
            // 无标签响应是正常的，不增加错误计数
            // 确保状态已重置，可以继续轮询
            waitingForResponse = false;
          }
        } else {
          // 处理其他类型的响应帧（可能是错误响应或状态响应）
          #if RFID_DEBUG_ENABLED
          Serial.print("[RFID] ⚠️ 帧类型: 0x");
          if (buffer[1] < 0x10) Serial.print("0");
          Serial.print(buffer[1], HEX);
          Serial.print(" 0x");
          if (buffer[2] < 0x10) Serial.print("0");
          Serial.print(buffer[2], HEX);
          Serial.println(" (可能是无标签响应)");
          #endif
          // 无标签响应不算错误，但需要重置状态以继续轮询
          waitingForResponse = false;
        }
      } else {
        #if RFID_DEBUG_ENABLED
        Serial.println("[RFID] ⚠️ 帧头错误或数据长度不足");
        #endif
        consecutiveErrors++;
        // 确保状态已重置
        waitingForResponse = false;
      }
    }
    
    // 优化：更积极的超时检测（已在函数开始处处理，这里作为备用）
    // 如果等待响应时间过长（超过超时时间的1.5倍），强制重置状态
    // 这可以防止状态卡死导致的长时间间隔
    // if (isReading && waitingForResponse) {
    //   unsigned long waitTime = now - lastResponseTime;
    //   if (waitTime > RFID_RESPONSE_TIMEOUT * 1.5) {  // 从2倍减少到1.5倍，更及时
    //     #if RFID_DEBUG_ENABLED
    //     Serial.print("[RFID] ⚠️ 检测到异常长时间等待 (");
    //     Serial.print(waitTime);
    //     Serial.println("ms)，强制重置状态");
    //     #endif
    //     waitingForResponse = false;
    //     // 清空可能残留的数据
    //     while (rfidSerial->available()) {
    //       rfidSerial->read();
    //     }
    //   }
    // }
    
    return "";
  }

  String readTagTEST() {
    
    // ========== 步骤2: 处理接收到的数据 ==========
    if (rfidSerial->available()) {
               
      // // 等待帧头（进一步减少等待时间，避免长时间阻塞）
      // unsigned long startWait = millis();
      // while (rfidSerial->available() < 1 && (millis() - startWait) < 20) {  // 从50ms减少到20ms
      //   yield();  // 使用yield()而不是delay(1)，让出CPU时间
      // }
      
      //每次读取之前都从静态暂存变量中读取上一次的已读取结果。
      //1. 检查暂存区状态,如果没有缓存，则视作新数据，检查头位帧是否为0xBB
      if(tempBufferLen == 0){
        Serial.print("首次读取！");
         tempBuffer[0] = rfidSerial->read();
        if (tempBuffer[0] != 0xBB){
          Serial.print("失败！");
           // 帧头错误，清空缓冲区
          drainSerialInput();
          consecutiveErrors++;
          // 确保状态已重置
          waitingForResponse = false;
          return "";
        } 
        else{
          Serial.print("成功！");
          tempBufferLen = 1;
        }
      }
      bool haveEnd = false;
      //2. 基于已有缓存做读取，每次更新tempBufferLen，如果此次没有读完，则直接跳过留给下一轮轮询。
      int len = rfidSerial->available();
      for(int i = 0;i<len;i++){
        tempBuffer[tempBufferLen] = rfidSerial->read();
        tempBufferLen++;
        //检查是否到达帧尾
        if(tempBuffer[tempBufferLen - 1] == 0x7E){
          haveEnd = true;
          break;
        }
        yield();
      }
      if(!haveEnd){
        Serial.print("⚠️本次未读取完成，以读长度：");
        Serial.println(tempBufferLen);
        return "";
      }

      if (tempBufferLen > 0 && tempBuffer[0] == 0xBB) {
        
        if (tempBuffer[1] == 0x02 && tempBuffer[2] == 0x22) {

          int dataLen = tempBuffer[4] * 256 + tempBuffer[5];
          int epcLen = dataLen - 3; // 减去RSSI(1) + PC(2)
          
          if (epcLen > 0) {
            String fullEPC = "";
            for (int i = 8; i < 8 + epcLen && i < tempBufferLen; i++) {
              if (tempBuffer[i] < 0x10) fullEPC += "0";
              fullEPC += String(tempBuffer[i], HEX);
            }
            fullEPC.toUpperCase();
            
            // 只返回前8位作为短EPC
            String shortEPC = fullEPC;
            if (fullEPC.length() >= 8) {
              shortEPC = fullEPC.substring(0, 8);
            }
            
            Serial.print("[RFID] ✅ 检测到标签 - 完整EPC: ");
            //Serial.print("[RFID] ✅ 检测到标签 - 使用EPC: ");
             Serial.print(fullEPC);
             Serial.print(", 使用EPC: ");
            Serial.print(shortEPC);
            
            // 检测到标签后，立即准备下次轮询（不延迟）
            // 注意：不在这里发送新指令，让主动轮询机制处理
            waitingForResponse = false;
            
            //XH 重置缓存区状态
            tempBufferLen = 0;
            return shortEPC;
          } else {
            #if RFID_DEBUG_ENABLED
            Serial.println("[RFID] ⚠️ EPC长度为0（无标签响应）");
            #endif
            // 无标签响应是正常的，不增加错误计数
            // 确保状态已重置，可以继续轮询
            waitingForResponse = false;
          }
        } else {
          //XH：减小信息量，此处不再输出
          // // 处理其他类型的响应帧（可能是错误响应或状态响应）
          // #if RFID_DEBUG_ENABLED
          // Serial.print("[RFID] ⚠️ 帧类型: 0x");
          // if (buffer[1] < 0x10) Serial.print("0");
          // Serial.print(buffer[1], HEX);
          // Serial.print(" 0x");
          // if (buffer[2] < 0x10) Serial.print("0");
          // Serial.print(buffer[2], HEX);
          // Serial.println(" (可能是无标签响应)");
          // #endif
          // // 无标签响应不算错误，但需要重置状态以继续轮询
          // waitingForResponse = false;
        }
      } else {
        #if RFID_DEBUG_ENABLED
        Serial.println("[RFID] ⚠️ 帧头错误或数据长度不足");
        #endif
        consecutiveErrors++;
        // 确保状态已重置
        waitingForResponse = false;
      }
      tempBufferLen = 0;
    }       
    return "";
  }

  String readTagEvent(){
    // Serial.print("当前队列长度:");
    // Serial.print(EPCQueueCount);
    return EPCDequeue();
    //return "";
  }

  void receiveTagMultiInventory() {
    // MULTI_INVENTORY_RECEIVE:
    // 多次轮询模式下，STM32 不重复发送盘点指令。
    // RFID 模块在收到 startMultiInventory() 后会主动通过串口上报标签帧。
    // 此函数只做串口读取、组帧和入队，避免在串口事件中执行复杂业务逻辑。
    if (!isReading) {
      return;
    }

    const unsigned int maxBytesPerCall = 96;
    readAvailableRfidFrames(maxBytesPerCall);
  }

  void receiveTag() {
    // SINGLE_INVENTORY_RECEIVE:
    // 当前主流程使用单次轮询。此函数主动发送盘点指令，
    // 并通过统一帧读取函数按协议长度组帧。
    // 1. 主动发送单次盘点指令
    rfidSerial->write(inventoryCmd, sizeof(inventoryCmd));
    rfidSerial->flush();
    #if RFID_DEBUG_ENABLED
    //Serial.println("[RFID] readTag: 发送单次轮询指令");
    #endif

    // 2. 重置缓冲区状态（开始新的响应接收）
    tempBufferLen = 0;
    
    // 3. 设置超时时间，等待接收所有响应帧
    unsigned long startTime = millis();
    unsigned long lastByteTime = startTime;
    const unsigned long timeout = 300; // 如 200ms
    const unsigned long interFrameGap = 20; // 帧间间隔超时（ms），无新数据则结束

    while (true) {
      unsigned long now = millis();
      
      // 总体超时保护
      if (now - startTime > timeout) {
        #if RFID_DEBUG_ENABLED
        //Serial.println("[RFID] 接收超时，结束读取");
        #endif
        break;
      }
      
      readAvailableRfidFrames(sizeof(tempBuffer), &lastByteTime);
      
      // 如果连续一段时间没有收到新数据，认为所有帧已接收完毕
      if (now - lastByteTime > interFrameGap) {
        break;
      }
      
      // 让出 CPU 避免忙等待（适用于 RTOS 或非抢占式调度）
      yield();
    }
    
    // 注意：完整帧不再依赖任意 0x7E 判断，而是通过参数长度计算总帧长。
    // 当前函数每次调用会发送新的单次盘点指令，因此调用开始处会重置帧缓冲。
  }
  
  // ========== 步骤3: 错误恢复机制 ==========
  void performErrorRecovery() {
    Serial.println("[RFID] 🔄 执行错误恢复流程...");
    
    // 1. 清空串口缓冲区
    drainSerialInput();
    delay(50);
    
    // 2. 发送停止指令
    rfidSerial->write(stopCmd, sizeof(stopCmd));
    delay(100);
    
    // 3. 清空缓冲区
    drainSerialInput();
    delay(50);
    
    // 4. 重新发送轮询指令
    Serial.println("[RFID] 🔄 重新初始化扫描...");
    rfidSerial->write(inventoryCmd, sizeof(inventoryCmd));
    lastPollTime = millis();
    lastResponseTime = millis();
    waitingForResponse = true;
    
    Serial.println("[RFID] ✅ 错误恢复完成");
  }
  
  bool checkConnection() {
    Serial.println("[RFID] 🔍 测试RFID阅读器连接...");
    byte cmd[] = {0xBB, 0x00, 0x03, 0x00, 0x01, 0x00, 0x04, 0x7E};
    
    #if RFID_DEBUG_ENABLED
    Serial.print("[RFID] 发送测试指令: ");
    for (int i = 0; i < sizeof(cmd); i++) {
      if (cmd[i] < 0x10) Serial.print("0");
      Serial.print(cmd[i], HEX);
      Serial.print(" ");
    }
    Serial.println();
    #endif
    
    // 清空缓冲区
    drainSerialInput();
    
    rfidSerial->write(cmd, sizeof(cmd));
    delay(200);
    
    if (rfidSerial->available()) {
      Serial.println("[RFID] ✅ 阅读器响应正常");
      // 清空缓冲区
      drainSerialInput();
      return true;
    } else {
      Serial.println("[RFID] ❌ 阅读器无响应");
      return false;
    }
  }
  
  // 辅助函数：读取完整响应帧
  int readResponseFrame(byte* buffer, int maxLen, unsigned long timeout = 300) {
    int len = 0;
    unsigned long startTime = millis();
    
    // 等待帧头
    while (rfidSerial->available() < 1 && (millis() - startTime) < timeout) {
      delay(1);
    }
    
    if (rfidSerial->available() > 0) {
      buffer[0] = rfidSerial->read();
      if (buffer[0] == 0xBB) {
        len = 1;
        // 读取剩余数据直到帧尾
        while (len < maxLen && (millis() - startTime) < timeout) {
          if (rfidSerial->available() > 0) {
            buffer[len] = rfidSerial->read();
            len++;
            // 检查是否到达帧尾
            if (buffer[len - 1] == 0x7E) {
              break;
            }
          } else {
            delay(1);
          }
        }
      } else {
        // 帧头错误，清空缓冲区
        drainSerialInput();
        return 0;
      }
    }
    
    return len;
  }
  
  // 设置RFID功率
  bool setPower(int powerLevel) {
    // 根据E720协议文档 4.22 设置发射功率
    // 参考文档：E720通讯协议使用说明V4.3.3.pdf 第35页
    // 
    // 指令格式：BB [Type] [Command] [PL(MSB)] [PL(LSB)] [Parameter...] [Checksum] 7E
    // 校验和：从Type到最后一个Parameter的累加和，只取最低字节（LSB）
    //
    // ⚠️ 注意：如果设备返回错误码0x17（命令帧中指令代码错误），
    //    说明命令码可能不正确，请查阅协议文档确认正确的命令码
    //    并修改下面代码中的0x2F
    
    if (powerLevel < 0 || powerLevel > 30) {
      Serial.println("[RFID] ❌ 功率值超出范围 (0-30 dBm)");
      return false;
    }
    
    Serial.print("[RFID] 🔧 设置功率: ");
    Serial.print(powerLevel);
    Serial.println(" dBm");
    
    // 根据E720协议，设置功率指令格式
    // BB 00 [Command] 00 01 [功率值] [校验] 7E
    // Type: 0x00 (命令帧)
    // Command: 0x2F (设置发射功率) - ⚠️ 如果错误，请查阅文档修改此值
    // PL: 0x0001 (参数长度1字节)
    // Parameter: 功率值 (0x00-0x1E, 即0-30 dBm)
    // Checksum: 0x00 + Command + 0x00 + 0x01 + 功率值 (取最低字节)
    byte powerValue = (byte)powerLevel;
    byte commandCode = 0x2F;  // 设置发射功率命令码 - 如果错误请修改
    byte checksum = (byte)(0x00 + commandCode + 0x00 + 0x01 + powerValue);
    byte setPowerCmd[] = {0xBB, 0x00, commandCode, 0x00, 0x01, powerValue, checksum, 0x7E};
    
    #if RFID_DEBUG_ENABLED
    Serial.print("[RFID] 发送设置功率指令: ");
    for (int i = 0; i < sizeof(setPowerCmd); i++) {
      if (setPowerCmd[i] < 0x10) Serial.print("0");
      Serial.print(setPowerCmd[i], HEX);
      Serial.print(" ");
    }
    Serial.println();
    #endif
    
    // 清空缓冲区
    drainSerialInput();
    delay(50);
    
    // 发送指令
    rfidSerial->write(setPowerCmd, sizeof(setPowerCmd));
    rfidSerial->flush();  // 确保数据发送完成
    delay(200);
    
    // 读取响应
    byte buffer[16];
    int len = readResponseFrame(buffer, 16, 300);
    
    if (len > 0 && buffer[0] == 0xBB) {
      #if RFID_DEBUG_ENABLED
      Serial.print("[RFID] 收到响应: ");
      for (int i = 0; i < len && i < 8; i++) {
        if (buffer[i] < 0x10) Serial.print("0");
        Serial.print(buffer[i], HEX);
        Serial.print(" ");
      }
      Serial.println();
      #endif
      
      // 根据E720协议，成功响应格式：BB 01 [Command] 00 00 [校验] 7E
      // Type: 0x01 (响应帧)
      // Command: 应与发送的命令码相同
      // PL: 0x0000 (无数据)
      // Checksum: 0x01 + Command + 0x00 + 0x00
      if (len >= 3) {
        if (buffer[1] == 0x01 && buffer[2] == commandCode) {
          Serial.println("[RFID] ✅ 功率设置成功");
          return true;
        } else if (buffer[1] == 0x01 && buffer[2] == 0xFF) {
          // 错误响应：BB 01 FF 00 01 [错误码] [校验] 7E
          // 错误码位置在buffer[6]
          Serial.print("[RFID] ❌ 功率设置失败，错误码: 0x");
          if (len >= 7) {
            if (buffer[6] < 0x10) Serial.print("0");
            Serial.print(buffer[6], HEX);
            Serial.print(" (");
            // 解释错误码（根据E720协议文档第6章）
            switch (buffer[6]) {
              case 0x10: Serial.print("写标签数据存储区失败"); break;
              case 0x11: Serial.print("指令格式错误"); break;
              case 0x12: Serial.print("灭活标签失败"); break;
              case 0x13: Serial.print("锁定标签数据存储区失败"); break;
              case 0x14: Serial.print("BlockPermalock失败"); break;
              case 0x15: Serial.print("轮询操作失败"); break;
              case 0x16: Serial.print("访问标签失败"); break;
              case 0x17: Serial.print("命令帧中指令代码错误（命令码可能不正确）"); break;
              case 0x18: Serial.print("未知错误或设备不支持该指令（可能需要不同的命令码）"); break;
              case 0x20: Serial.print("跳频搜索信道超时"); break;
              default: Serial.print("未知错误"); break;
            }
            Serial.println(")");
          } else {
            Serial.println("未知");
          }
          return false;
        } else {
          #if RFID_DEBUG_ENABLED
          Serial.print("[RFID] ⚠️ 功率设置响应格式异常: ");
          Serial.print("Type=0x");
          if (buffer[1] < 0x10) Serial.print("0");
          Serial.print(buffer[1], HEX);
          Serial.print(", Command=0x");
          if (buffer[2] < 0x10) Serial.print("0");
          Serial.println(buffer[2], HEX);
          #endif
          // 某些设备可能返回不同格式，但设置可能已成功
          Serial.println("[RFID] ⚠️ 响应格式异常，但可能已设置成功");
          return true;
        }
      }
    }
    
    Serial.println("[RFID] ⚠️ 未收到功率设置响应");
    return false;
  }
  
  // 查询当前功率
  int getPower() {
    // 根据E720协议文档 4.21 获取发射功率
    // 参考文档：E720通讯协议使用说明V4.3.3.pdf 第34页
    //
    // 指令格式：BB [Type] [Command] [PL(MSB)] [PL(LSB)] [Parameter...] [Checksum] 7E
    // 校验和：从Type到最后一个Parameter的累加和，只取最低字节（LSB）
    //
    // ⚠️ 注意：如果设备返回错误码0x17（命令帧中指令代码错误），
    //    说明命令码可能不正确，请查阅协议文档确认正确的命令码
    //    并修改下面代码中的0x31
    
    // Type: 0x00 (命令帧)
    // Command: 0x31 (获取发射功率) - ⚠️ 如果错误，请查阅文档修改此值
    // PL: 0x0000 (无参数)
    // Checksum: 0x00 + Command + 0x00 + 0x00
    byte commandCode = 0x31;  // 获取发射功率命令码 - 如果错误请修改
    byte checksum = (byte)(0x00 + commandCode + 0x00 + 0x00);
    byte queryPowerCmd[] = {0xBB, 0x00, commandCode, 0x00, 0x00, checksum, 0x7E};
    
    #if RFID_DEBUG_ENABLED
    Serial.print("[RFID] 发送查询功率指令: ");
    for (int i = 0; i < sizeof(queryPowerCmd); i++) {
      if (queryPowerCmd[i] < 0x10) Serial.print("0");
      Serial.print(queryPowerCmd[i], HEX);
      Serial.print(" ");
    }
    Serial.println();
    #endif
    
    // 清空缓冲区
    drainSerialInput();
    delay(50);
    
    // 发送指令
    rfidSerial->write(queryPowerCmd, sizeof(queryPowerCmd));
    rfidSerial->flush();  // 确保数据发送完成
    delay(200);
    
    // 读取响应
    byte buffer[16];
    int len = readResponseFrame(buffer, 16, 300);
    
    if (len > 0 && buffer[0] == 0xBB) {
      #if RFID_DEBUG_ENABLED
      Serial.print("[RFID] 收到响应: ");
      for (int i = 0; i < len && i < 8; i++) {
        if (buffer[i] < 0x10) Serial.print("0");
        Serial.print(buffer[i], HEX);
        Serial.print(" ");
      }
      Serial.println();
      #endif
      
      // 响应格式：BB 01 [Command] 00 01 [功率值] [校验] 7E
      // Type: 0x01 (响应帧)
      // Command: 应与发送的命令码相同
      // PL: 0x0001 (数据长度1字节)
      // Parameter: 功率值 (0x00-0x1E, 即0-30 dBm)
      if (len >= 7) {
        if ((buffer[1] == 0x01 && buffer[2] == commandCode) || 
            (buffer[1] == 0x00 && buffer[2] == commandCode)) {
          // 检查数据长度
          int dataLen = buffer[4] * 256 + buffer[5];
          if (dataLen >= 1 && len >= 7) {
            int powerLevel = buffer[6];
            if (powerLevel >= 0 && powerLevel <= 30) {
              Serial.print("[RFID] ✅ 当前功率: ");
              Serial.print(powerLevel);
              Serial.println(" dBm");
              return powerLevel;
            } else {
              Serial.print("[RFID] ⚠️ 功率值异常: ");
              Serial.println(powerLevel);
              return -1;
            }
          }
        } else if (buffer[1] == 0x01 && buffer[2] == 0xFF) {
          // 错误响应：BB 01 FF 00 01 [错误码] [校验] 7E
          Serial.print("[RFID] ❌ 查询功率失败，错误码: 0x");
          if (len >= 7) {
            if (buffer[6] < 0x10) Serial.print("0");
            Serial.print(buffer[6], HEX);
            Serial.print(" (");
            // 解释错误码
            switch (buffer[6]) {
              case 0x10: Serial.print("指令不支持"); break;
              case 0x11: Serial.print("指令格式错误"); break;
              case 0x12: Serial.print("参数错误"); break;
              case 0x13: Serial.print("校验和错误"); break;
              case 0x14: Serial.print("数据长度错误"); break;
              case 0x15: Serial.print("操作失败"); break;
              case 0x16: Serial.print("设备忙"); break;
              case 0x17: Serial.print("超时"); break;
              case 0x18: Serial.print("未知错误或设备不支持该指令"); break;
              default: Serial.print("未知错误"); break;
            }
            Serial.println(")");
          } else {
            Serial.println("未知");
          }
          return -1;
        } else {
          #if RFID_DEBUG_ENABLED
          Serial.print("[RFID] ⚠️ 查询功率响应格式异常: ");
          Serial.print("0x");
          if (buffer[1] < 0x10) Serial.print("0");
          Serial.print(buffer[1], HEX);
          Serial.print(" 0x");
          if (buffer[2] < 0x10) Serial.print("0");
          Serial.println(buffer[2], HEX);
          #endif
        }
      }
    }
    
    Serial.println("[RFID] ⚠️ 未收到功率查询响应或响应格式错误");
    return -1;  // 返回-1表示查询失败
  }
  
  bool isScanning() {
    return isReading;
  }
  
  // 获取调试信息
  void printDebugInfo() {
    Serial.println("\n=== RFID调试信息 ===");
    Serial.print("扫描状态: ");
    Serial.println(isReading ? "运行中" : "已停止");
    Serial.print("等待响应: ");
    Serial.println(waitingForResponse ? "是" : "否");
    Serial.print("连续错误: ");
    Serial.println(consecutiveErrors);
    Serial.print("距上次轮询: ");
    Serial.print(millis() - lastPollTime);
    Serial.println("ms");
    Serial.print("距上次响应: ");
    Serial.print(millis() - lastResponseTime);
    Serial.println("ms");
    Serial.print("串口可用数据: ");
    Serial.println(rfidSerial->available());
    Serial.println("==================\n");
  }
};

#endif
